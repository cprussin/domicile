// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/shell_fetch.h"

#include <initializer_list>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "components/domicile/mojom/shell_fetch.mojom.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "url/gurl.h"

namespace domicile {
namespace {

constexpr char kInbox[] =
    "https://clients6.google.com/gmail/v1/users/me/labels/INBOX";
constexpr char kMail[] = "https://mail.google.com";

std::vector<mojom::ShellFetchHeaderPtr> Headers(
    std::initializer_list<std::pair<const char*, const char*>> headers) {
  std::vector<mojom::ShellFetchHeaderPtr> made;
  for (const auto& [name, value] : headers) {
    made.push_back(mojom::ShellFetchHeader::New(name, value));
  }
  return made;
}

// What the Gmail bar item sends.
TEST(ShellFetchTest, AnHttpsGetWithItsOwnHeadersIsAllowed) {
  EXPECT_EQ(ShellFetchRefusal(GURL(kInbox),
                              Headers({{"X-Origin", kMail},
                                       {"X-Goog-AuthUser", "me@example.com"}}),
                              kMail, /*desk_locked=*/false),
            std::nullopt);
}

TEST(ShellFetchTest, NothingIsFetchedWhileTheDeskIsLocked) {
  EXPECT_TRUE(ShellFetchRefusal(GURL(kInbox), Headers({}), std::nullopt,
                                /*desk_locked=*/true));
}

TEST(ShellFetchTest, OnlyAnHttpsAddressIsFetched) {
  for (const char* url :
       {"http://mail.google.com/", "domicile://home/notes.txt",
        "file:///etc/passwd", "not an address"}) {
    EXPECT_TRUE(ShellFetchRefusal(GURL(url), Headers({}), std::nullopt,
                                  /*desk_locked=*/false))
        << url;
  }
}

// The browser sends the profile's cookies; a page adds none of its own.
TEST(ShellFetchTest, APageSendsNoCookieHeader) {
  for (const char* name : {"Cookie", "cookie"}) {
    EXPECT_TRUE(ShellFetchRefusal(GURL(kInbox), Headers({{name, "SID=x"}}),
                                  std::nullopt, /*desk_locked=*/false))
        << name;
  }
}

// The browser sends a POST's `Origin` as the address's own, and a GET's
// none, so a page cannot claim another.
TEST(ShellFetchTest, APageSendsNoOriginHeader) {
  for (const char* name : {"Origin", "origin"}) {
    EXPECT_TRUE(ShellFetchRefusal(GURL(kInbox), Headers({{name, kMail}}),
                                  std::nullopt, /*desk_locked=*/false))
        << name;
  }
}

TEST(ShellFetchTest, AHeaderTheNetworkStackOwnsIsRefused) {
  for (const char* name :
       {"Host", "Content-Length", "Proxy-Authorization", "Set-Cookie"}) {
    EXPECT_TRUE(ShellFetchRefusal(GURL(kInbox), Headers({{name, "x"}}),
                                  std::nullopt, /*desk_locked=*/false))
        << name;
  }
}

TEST(ShellFetchTest, AMalformedHeaderIsRefused) {
  EXPECT_TRUE(ShellFetchRefusal(GURL(kInbox), Headers({{"Bad Name", "x"}}),
                                std::nullopt, /*desk_locked=*/false));
  EXPECT_TRUE(ShellFetchRefusal(GURL(kInbox), Headers({{"X-A", "x\r\nB: y"}}),
                                std::nullopt, /*desk_locked=*/false));
}

// An origin, as `Origin` spells it: no path, no other scheme.
TEST(ShellFetchTest, TheHashIsForAnHttpsOrigin) {
  for (const char* origin :
       {"https://mail.google.com/", "http://mail.google.com",
        "mail.google.com", ""}) {
    EXPECT_TRUE(ShellFetchRefusal(GURL(kInbox), Headers({}),
                                  std::string(origin), /*desk_locked=*/false))
        << origin;
  }
}

// The hash is the `Authorization` header, so a page's own would collide.
TEST(ShellFetchTest, AHashedRequestHasNoAuthorizationOfItsOwn) {
  EXPECT_TRUE(ShellFetchRefusal(GURL(kInbox),
                                Headers({{"Authorization", "Bearer x"}}), kMail,
                                /*desk_locked=*/false));
  EXPECT_EQ(ShellFetchRefusal(GURL(kInbox),
                              Headers({{"Authorization", "Bearer x"}}),
                              std::nullopt, /*desk_locked=*/false),
            std::nullopt);
}

// sha1("1700000000 abc123 https://mail.google.com"), from `sha1sum`.
TEST(ShellFetchTest, TheHashIsTheTimeAndTheSha1OfTimeCookieAndOrigin) {
  EXPECT_EQ(SapisidHash("abc123", kMail, 1700000000),
            "SAPISIDHASH 1700000000_0869774bcf81f8d885cb74e83b21f087bf7bc5ef");
}

TEST(ShellFetchTest, TheSapisidIsTheFirstPartyCookieElseTheSecureOne) {
  EXPECT_EQ(SapisidAmong({{"SID", "a"},
                          {"__Secure-3PAPISID", "secure"},
                          {"SAPISID", "plain"}}),
            "plain");
  EXPECT_EQ(SapisidAmong({{"SID", "a"}, {"__Secure-3PAPISID", "secure"}}),
            "secure");
  EXPECT_EQ(SapisidAmong({{"SID", "a"}}), std::nullopt);
}

// What the Gmail bar item sends: a GET of its page and a POST to its sync.
TEST(ShellFetchTest, AGetOrAPostIsSent) {
  EXPECT_EQ(ShellFetchMethodRefusal("GET", std::nullopt), std::nullopt);
  EXPECT_EQ(ShellFetchMethodRefusal("POST", "[null,null,1]"), std::nullopt);
  EXPECT_EQ(ShellFetchMethodRefusal("POST", std::nullopt), std::nullopt);
}

TEST(ShellFetchTest, NoOtherMethodIsSent) {
  for (const char* method : {"PUT", "DELETE", "HEAD", "get", ""}) {
    EXPECT_TRUE(ShellFetchMethodRefusal(method, std::nullopt)) << method;
  }
}

TEST(ShellFetchTest, AGetSendsNoBody) {
  EXPECT_TRUE(ShellFetchMethodRefusal("GET", ""));
}

TEST(ShellFetchTest, ABodyIsNoLargerThanAResponse) {
  EXPECT_TRUE(ShellFetchMethodRefusal(
      "POST", std::string(kShellFetchMaxBody + 1, 'x')));
}

// A POST's body would be sent again to wherever a redirect points, and a hash
// is for its own origin. Only a plain GET moves.
TEST(ShellFetchTest, OnlyAPlainGetFollowsRedirects) {
  EXPECT_TRUE(ShellFetchFollowsRedirects("GET", /*hashed=*/false));
  EXPECT_FALSE(ShellFetchFollowsRedirects("POST", /*hashed=*/false));
  EXPECT_FALSE(ShellFetchFollowsRedirects("GET", /*hashed=*/true));
}

// A redirect may move the request, never off https: the first address's
// check holds for every one after it.
TEST(ShellFetchTest, ARedirectStaysOnHttps) {
  EXPECT_EQ(ShellFetchRedirectRefusal(
                GURL("https://accounts.google.com/ServiceLogin")),
            std::nullopt);
  for (const char* url : {"http://mail.google.com/", "file:///etc/passwd",
                          "domicile://home/notes.txt"}) {
    EXPECT_TRUE(ShellFetchRedirectRefusal(GURL(url))) << url;
  }
}

// The page's headers are for the origin it named, such as an
// `X-Goog-AuthUser`; another origin gets none of them.
TEST(ShellFetchTest, ARedirectToAnotherOriginDropsThePagesHeaders) {
  EXPECT_EQ(ShellFetchHeadersDroppedOnRedirect(
                GURL(kInbox), GURL("https://evil.example/"),
                Headers({{"Authorization", "Bearer x"},
                         {"X-Goog-AuthUser", "me@example.com"}})),
            (std::vector<std::string>{"Authorization", "X-Goog-AuthUser"}));
}

TEST(ShellFetchTest, ARedirectWithinTheOriginKeepsThePagesHeaders) {
  EXPECT_EQ(ShellFetchHeadersDroppedOnRedirect(
                GURL(kInbox),
                GURL("https://clients6.google.com/gmail/v1/other"),
                Headers({{"X-Goog-AuthUser", "me@example.com"}})),
            std::vector<std::string>());
}

TEST(ShellFetchTest, AnHttpStatusReachesThePage) {
  EXPECT_EQ(ShellFetchStatus(200), 200);
  EXPECT_EQ(ShellFetchStatus(999), 999);
}

// //net reads any integer as a status; the page reads an unsigned short.
TEST(ShellFetchTest, AStatusHttpDoesNotHaveIsRefused) {
  for (int code : {-1, 0, 99, 1000, 70000}) {
    EXPECT_EQ(ShellFetchStatus(code), std::nullopt) << code;
  }
}

}  // namespace
}  // namespace domicile

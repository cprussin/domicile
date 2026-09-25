// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_LINE_FRAMER_H_
#define COMPONENTS_DOMICILE_BROWSER_LINE_FRAMER_H_

#include <string>
#include <string_view>
#include <vector>

namespace domicile {

// Newline-framed lines out of a byte stream that arrives in pieces.
//
// The compositor's socket is one JSON object per line, read a buffer at a time,
// and a line is as long as the compositor made it. EACH BYTE IS SEARCHED FOR A
// NEWLINE ONCE, on the read it arrived in -- the reader this replaced searched
// the whole of what it was holding on every read, which on a line of many reads
// is quadratic, and was seconds of the browser's IO thread on one message.
class LineFramer {
 public:
  LineFramer();
  LineFramer(const LineFramer&) = delete;
  LineFramer& operator=(const LineFramer&) = delete;
  ~LineFramer();

  // The lines `bytes` finishes, without their newlines, in order. What is left
  // after the last newline is held for the next call.
  std::vector<std::string> Take(std::string_view bytes);

 private:
  // The start of a line whose newline has not arrived yet.
  std::string pending_;
};

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_LINE_FRAMER_H_

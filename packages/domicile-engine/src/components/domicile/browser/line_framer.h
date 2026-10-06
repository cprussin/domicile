// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_LINE_FRAMER_H_
#define COMPONENTS_DOMICILE_BROWSER_LINE_FRAMER_H_

#include <string>
#include <string_view>
#include <vector>

namespace domicile {

// Splits a byte stream that arrives in chunks into newline-terminated lines.
//
// The compositor sends one JSON object per line, and lines can span many
// reads. Each byte is searched once so long lines stay linear.
class LineFramer {
 public:
  LineFramer();
  LineFramer(const LineFramer&) = delete;
  LineFramer& operator=(const LineFramer&) = delete;
  ~LineFramer();

  // Returns the lines `bytes` completes, without newlines. Keeps the remainder
  // for the next call.
  std::vector<std::string> Take(std::string_view bytes);

 private:
  // The start of a line whose newline has not arrived.
  std::string pending_;
};

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_LINE_FRAMER_H_

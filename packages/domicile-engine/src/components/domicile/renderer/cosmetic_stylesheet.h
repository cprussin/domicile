// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_RENDERER_COSMETIC_STYLESHEET_H_
#define COMPONENTS_DOMICILE_RENDERER_COSMETIC_STYLESHEET_H_

#include <string>
#include <string_view>
#include <vector>

namespace domicile {

// The stylesheet CosmeticFilters puts in a page (cosmetic_filters.h): one
// rule per selector, each `display: none !important`, so an invalid
// selector drops only its own rule where one list of them would drop all.
// A selector with `{` or `}` is left out, since it could end its rule and
// style the page.
std::string CosmeticStylesheetOf(const std::vector<std::string>& selectors);

// The class names in an element's `class` attribute, split on whitespace.
std::vector<std::string> ClassesOf(std::string_view attribute);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_RENDERER_COSMETIC_STYLESHEET_H_

export const getInitials = (name: string): string => {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((part) => part !== "");
  const first = parts[0];
  if (first === undefined) {
    return "?";
  } else {
    const last = parts[parts.length - 1];
    const firstChar = ([...first][0] ?? "").toUpperCase();
    if (last === undefined || last === first) {
      return firstChar;
    } else {
      const lastChar = ([...last][0] ?? "").toUpperCase();
      return firstChar + lastChar;
    }
  }
};

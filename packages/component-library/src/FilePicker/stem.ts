/**
 * Where a file name's stem ends: before its last extension. A leading dot
 * starts a hidden name, not an extension.
 */
export const stemEnd = (name: string): number => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? dot : name.length;
};

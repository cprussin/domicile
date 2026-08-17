export const getGradient = (name: string): string => {
  const normalized = name.trim().toLowerCase();
  const seed = hashString(normalized === "" ? "?" : normalized);
  const hueA = seed % 360;
  const hueB = (hueA + 30 + ((seed >>> 8) % 60)) % 360;
  const hueC = (hueA + 180 + ((seed >>> 16) % 40)) % 360;
  return `linear-gradient(135deg, hsl(${hueA}, 95%, 72%) 0%, hsl(${hueB}, 90%, 68%) 55%, hsl(${hueC}, 95%, 70%) 100%)`;
};

const hashString = (str: string): number => {
  let h = 2_166_136_261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16_777_619);
  }
  return h >>> 0;
};

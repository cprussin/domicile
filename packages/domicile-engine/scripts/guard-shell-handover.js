// The shell guard-shell-handover.sh drives. It reports what the engine called
// it with, and whether anything else on the page can find the desktop:
//
//   GUARD handover root=<body|…> desktop=<yes|no> navigator=<none|…>
//                  window=<none|…>

export const Shell = (root, desktop) => {
  const answers =
    desktop !== null && desktop !== undefined && Array.isArray(desktop.windows);
  console.log(
    "GUARD handover" +
      ` root=${root === document.body ? "body" : String(root)}` +
      ` desktop=${answers ? "yes" : "no"}` +
      ` navigator=${"domicile" in navigator ? "present" : "none"}` +
      ` window=${"domicile" in window ? "present" : "none"}`,
  );
};

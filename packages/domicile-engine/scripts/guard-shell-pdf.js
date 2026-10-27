// The shell guard-shell-pdf.sh drives: a PDF from domicile://home/ in an
// <iframe>, as the launcher's preview shows one.
//
//   GUARD pdf-frame-loaded
//
// Domicile calls `HostShell` once the module loads.

export const HostShell = (root) => {
  const frame = document.createElement("iframe");
  frame.style.inlineSize = "600px";
  frame.style.blockSize = "400px";
  frame.addEventListener("load", () => {
    console.log("GUARD pdf-frame-loaded");
  });
  frame.src = "domicile://home/guard-shell-pdf.pdf#toolbar=0&navpanes=0";
  root.append(frame);
};

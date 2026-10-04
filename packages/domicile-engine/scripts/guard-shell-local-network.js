// Shell module for guard-shell-local-network.sh: one <img> from a local
// server, like a launcher favicon for a bookmark on localhost. The control
// page is served by guard-shell-local-network-server.py.

export const Shell = () => {
  /** Reads a required query parameter. */
  const required = (parameters, name) => {
    const value = parameters.get(name);
    if (value === null) {
      throw new Error(`guard-shell-local-network: ?${name}= is required`);
    } else {
      return value;
    }
  };

  const parameters = new URLSearchParams(location.search);
  const picture = document.createElement("img");

  // Inset so the witness shows around it. Whole percentages keep the color on
  // integer pixels. Matches the control page's inset.
  picture.alt = "";
  picture.style.position = "absolute";
  picture.style.left = "10%";
  picture.style.top = "10%";
  picture.style.width = "80%";
  picture.style.height = "70%";

  document.body.style.background = `#${required(parameters, "witness")}`;
  document.body.append(picture);
  picture.src = required(parameters, "src");
};

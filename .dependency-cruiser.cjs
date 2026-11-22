/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      comment: "No dependency cycles. Extract the shared piece into its own module that both sides import.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "lib-does-not-import-ui",
      comment:
        "src/lib is the domain and data layer. It must not depend on routes or components; pass what it needs in as arguments instead.",
      severity: "error",
      from: { path: "^src/lib/" },
      to: { path: "^src/(app|components)/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: { extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".json"] },
  },
};

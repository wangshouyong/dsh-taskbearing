export default {
  define: {
    "process.env.NODE_ENV": '"production"'
  },
  build: {
    lib: {
      entry: "src/client/entry.js",
      formats: ["cjs"],
      fileName: () => "client.inner.cjs"
    },
    rollupOptions: {
      external: ["react", "react-dom", "react/jsx-runtime"]
    },
    outDir: "lib",
    emptyOutDir: false,
    sourcemap: false
  }
};

// Overwritten by release.py when a release is frozen. In the working copy this
// stays "dev", which is exactly what you want to see in the footer while you
// are editing files. Loaded before core.js so localStorage keys can be
// namespaced per build synchronously - see NOTES.md, "Release isolation".
window.KVA_BUILD = "dev";
window.KVA_BUILD_HASH = "";

export default {
  '*.{js,cjs,mjs,ts,cts,mts,tsx,jsx,json,jsonc,md,yml,yaml}': ['oxfmt --write'],
  '*.{js,cjs,mjs,ts,cts,mts,tsx,jsx}': ['oxlint'],
};

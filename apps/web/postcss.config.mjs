/**
 * Tailwind v4 se zapojuje jediným pluginem `@tailwindcss/postcss`.
 * Vkládání importů i dopisování prefixů si plugin řeší sám, takže
 * `postcss-import` ani `autoprefixer` v seznamu nejsou.
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;

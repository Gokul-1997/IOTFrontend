/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class', // ✅ REQUIRED
  content: [
    './src/**/*.{html,ts}'
  ],
  theme: {
    extend: {
      colors: {
        'bg-light-gray': 'var(--color-bg-light-gray)',
      },
      fontFamily: {
        ubuntu: ['Ubuntu', 'sans-serif'],
        franklin: ['Libre Franklin', 'sans-serif'],
      }
    },
  },
  plugins: [],
}

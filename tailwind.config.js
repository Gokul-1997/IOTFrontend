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
    },
  },
  plugins: [],
}

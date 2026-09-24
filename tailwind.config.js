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
        blue: { 50: '#f0f5ff', 100: '#e5edff', 200: '#cdddff', 300: '#a9c7ff', 400: '#7ba5ff', 500: '#527ee8', 600: '#3564df', 700: '#244bb5', 800: '#1b3c90', 900: '#172b51' },
        indigo: { 50: '#f1f5ed', 100: '#e7eddf', 200: '#d2dfbf', 300: '#b8cd94', 400: '#93ad62', 500: '#779143', 600: '#527638', 700: '#41612c', 800: '#344c26', 900: '#253a1e' },
      },
      fontFamily: {
        ubuntu: ['Avenir Next', 'Segoe UI', 'Arial', 'sans-serif'],
        franklin: ['Avenir Next', 'Segoe UI', 'Arial', 'sans-serif'],
      },
      keyframes: {
    blink: {
      '0%, 100%': { borderColor: 'transparent' },
      '50%': { borderColor: '#fb3748' }, // red
    },
    borderMove: {
      '0%': { backgroundPosition: '0% 50%' },
      '100%': { backgroundPosition: '100% 50%' },
    },
  },
  animation: {
    blink: 'blink 1s infinite',
    borderMove: 'borderMove 3s linear infinite',
  }
    },
  },
  plugins: [],
}

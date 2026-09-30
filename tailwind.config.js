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
        // Axis: electric blue and brand violet, so the older pages' blue and indigo utilities match the rest
        blue: { 50: '#eef5ff', 100: '#d9e8ff', 200: '#bcd6ff', 300: '#8ebcff', 400: '#5a98ff', 500: '#2f7bff', 600: '#1d5fd8', 700: '#1a4db0', 800: '#1b418c', 900: '#1c3a70' },
        indigo: { 50: '#f1efff', 100: '#e4e0ff', 200: '#cdc5ff', 300: '#aa9bff', 400: '#8a73ff', 500: '#6a4dff', 600: '#5b3df5', 700: '#4a2fe0', 800: '#3d27b5', 900: '#33248f' },
      },
      fontFamily: {
        ubuntu: ['Ubuntu', 'sans-serif'],
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

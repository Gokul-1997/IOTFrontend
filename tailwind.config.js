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
        blue: { 50: '#eef6fc', 100: '#d9eaf7', 200: '#b3d4ee', 300: '#85b9e2', 400: '#4f98d2', 500: '#1f79c0', 600: '#006ab5', 700: '#005b9e', 800: '#004a82', 900: '#003f70' },
        indigo: { 50: '#eef6fc', 100: '#d9eaf7', 200: '#b3d4ee', 300: '#85b9e2', 400: '#4f98d2', 500: '#1f79c0', 600: '#006ab5', 700: '#005b9e', 800: '#004a82', 900: '#003f70' },
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

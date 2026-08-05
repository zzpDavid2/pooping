/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 主色：厕纸黄褐，不用真·屎色，避免视觉上太脏
        poo: {
          50: '#fdf8f3',
          100: '#f7ead9',
          200: '#edd2b0',
          300: '#e0b382',
          400: '#d1915a',
          500: '#c07540',
          600: '#a45c33',
          700: '#84472c',
          800: '#6b3b28',
          900: '#583224',
        },
        ink: {
          DEFAULT: '#1c1917',
          soft: '#57534e',
          faint: '#a8a29e',
        },
      },
      fontFamily: {
        // 零外部字体请求：全部走系统字体栈（见 CLAUDE.md 3.3 / 8.1）
        // CJK 字体动辄数 MB，打包进来对国内首屏是灾难，系统字体是唯一正确解
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Microsoft YaHei"',
          '"Noto Sans CJK SC"',
          '"Source Han Sans SC"',
          'sans-serif',
        ],
        serif: [
          '"Songti SC"',
          '"SimSun"',
          '"Noto Serif CJK SC"',
          'Georgia',
          'serif',
        ],
      },
      keyframes: {
        'slide-up': {
          '0%': { transform: 'translateY(100%)' },
          '100%': { transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
      animation: {
        'slide-up': 'slide-up 0.22s cubic-bezier(0.32, 0.72, 0, 1)',
        'fade-in': 'fade-in 0.18s ease-out',
      },
    },
  },
  plugins: [],
}

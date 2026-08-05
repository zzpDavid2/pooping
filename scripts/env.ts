import { config } from 'dotenv'

/**
 * 脚本侧的环境变量加载。
 *
 * Vite 会自动读 .env.local，但 Node 不会 —— dotenv 默认只认 .env。
 * 按 .env.local → .env 的顺序加载，dotenv 不覆盖已存在的变量，
 * 所以先加载的优先，和 Vite 的优先级保持一致。
 */
config({ path: '.env.local' })
config({ path: '.env' })

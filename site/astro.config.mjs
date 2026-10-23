import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'

// Deployed to GitHub Pages project site:
//   https://sogeisetsu.github.io/opencode-skill-management/
// English is the root locale; Chinese lives under /zh-cn/.
export default defineConfig({
  site: 'https://sogeisetsu.github.io',
  base: '/opencode-skill-management',
  trailingSlash: 'always',
  integrations: [
    starlight({
      title: 'opencode-skill-management',
      description:
        'A native OpenCode V2 tool to list, inspect, disable and enable skills by writing one global permission rule.',
      defaultLocale: 'root',
      locales: {
        root: { label: 'English', lang: 'en' },
        'zh-cn': { label: '简体中文', lang: 'zh-CN' },
      },
      customCss: ['./src/styles/custom.css'],
      // Dark is the default look. This runs before Starlight's theme module
      // (which is deferred) and only seeds the value when the visitor has not
      // chosen a theme yet; the toggle still works and is remembered.
      head: [
        {
          tag: 'script',
          content:
            // null = no choice yet; '' is Starlight's stored value for Auto and
            // must be respected, otherwise Auto flips back to dark on every page.
            "try{if(localStorage.getItem('starlight-theme')===null)localStorage.setItem('starlight-theme','dark')}catch(e){}",
        },
      ],
      // Pagefind ships no Windows binary for this environment; the site is
      // small enough that the sidebar and full-text pages are the navigation.
      pagefind: false,
      // Keep the built output to the 10 documentation pages per locale, so the
      // English and Chinese route sets are exact mirrors.
      disable404Route: true,
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/sogeisetsu/opencode-skill-management',
        },
      ],
      editLink: {
        baseUrl:
          'https://github.com/sogeisetsu/opencode-skill-management/edit/main/site/',
      },
      sidebar: [
        {
          label: 'Getting started',
          translations: { 'zh-CN': '开始使用' },
          items: [
            { label: 'Overview', translations: { 'zh-CN': '概览' }, link: '/overview/' },
            {
              label: 'Installation',
              translations: { 'zh-CN': '安装' },
              link: '/installation/',
            },
          ],
        },
        {
          label: 'Actions',
          translations: { 'zh-CN': '四个动作' },
          items: [
            { label: 'list', link: '/actions/list/' },
            { label: 'inspect', link: '/actions/inspect/' },
            { label: 'disable', link: '/actions/disable/' },
            { label: 'enable', link: '/actions/enable/' },
          ],
        },
        {
          label: 'Reference',
          translations: { 'zh-CN': '参考' },
          items: [
            {
              label: 'Permissions & evaluation',
              translations: { 'zh-CN': '权限规则与求值模型' },
              link: '/permissions/',
            },
            {
              label: 'Troubleshooting & FAQ',
              translations: { 'zh-CN': '故障排查与 FAQ' },
              link: '/troubleshooting/',
            },
            {
              label: 'Compatibility & 1.x',
              translations: { 'zh-CN': '兼容性与 1.x 承诺' },
              link: '/compatibility/',
            },
          ],
        },
      ],
    }),
  ],
})

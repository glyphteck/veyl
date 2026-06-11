import { links } from '@veyl/shared/links';

const pages = [
    { path: '/join', priority: 1 },
    { path: '/download', priority: 0.6 },
    { path: '/legal', priority: 0.5 },
];

export default function sitemap() {
    return pages.map((page) => ({
        url: `${links.veyl}${page.path === '/' ? '' : page.path}`,
        changeFrequency: 'weekly',
        priority: page.priority,
    }));
}

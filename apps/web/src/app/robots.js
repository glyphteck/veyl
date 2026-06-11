import { links } from '@veyl/shared/links';

const privatePaths = [
    '/admin',
    '/camera',
    '/chat',
    '/community',
    '/getavatar',
    '/getpassword',
    '/getusername',
    '/login',
    '/newaccount',
    '/qr',
    '/review',
    '/transactions',
    '/unlock',
    '/wallet',
];

export default function robots() {
    return {
        rules: {
            userAgent: '*',
            allow: ['/', '/join', '/download', '/legal'],
            disallow: privatePaths,
        },
        sitemap: `${links.veyl}/sitemap.xml`,
        host: links.veyl,
    };
}

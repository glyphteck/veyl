import CommunityAck from './communityack';

export const metadata = {
    title: 'Community Rules',
    description: 'Review and accept the current veyl community rules.',
};

export default async function CommunityPage() {
    return <CommunityAck />;
}

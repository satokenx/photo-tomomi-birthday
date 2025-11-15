import type { Metadata, Viewport } from 'next';
import '@/styles/globals.scss';

export const metadata: Metadata = {
	title: 'Tomomi Birthday',
	description: 'Event photo album for Tomomi Birthday',
	openGraph: {
		title: 'Tomomi Birthday',
		description: 'Event photo album for Tomomi Birthday',
		images: [{ url: '/Key_view.png', width: 768, height: 768 }]
	},
	twitter: {
		card: 'summary_large_image',
		title: 'Tomomi Birthday',
		description: 'Event photo album for Tomomi Birthday',
		images: ['/Key_view.png']
	}
};

export const viewport: Viewport = {
	width: 'device-width',
	initialScale: 1,
	viewportFit: 'cover'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="ja">
			<body>
				{children}
			</body>
		</html>
	);
}



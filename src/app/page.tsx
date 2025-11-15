import AuthButtons from '@/components/AuthButtons';
import UploadForm from '@/components/UploadForm';
import PhotoGrid from '@/components/PhotoGrid';
import { Playfair_Display } from 'next/font/google';

const playfair = Playfair_Display({ subsets: ['latin'], weight: ['700'] });

export default function HomePage() {
	return (
		<main className="container">
			<h1 className={`${playfair.className} title`}>Tomomi Birthday</h1>
			<section className="hero" aria-label="Hero media">
				<video
					className="hero-video"
					src="/Hero_view.mp4"
					autoPlay
					loop
					muted
					playsInline
					disablePictureInPicture
					controlsList="nodownload noplaybackrate noremoteplayback nofullscreen"
					poster="/Key_view.png"
				/>
			</section>

			<section className="section card" style={{ display: 'grid', gap: 12 }}>
				<UploadForm />
			</section>

			<section className="section">
				<PhotoGrid />
			</section>
		</main>
	);
}



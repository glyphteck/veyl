import Image from 'next/image';
import Webcam from 'react-webcam';

export function CameraStage({ capture, cloaked, onUserMedia, webcamRef }) {
    return (
        <div className="absolute inset-0">
            <div className="absolute inset-0 -scale-x-100">
                <Webcam
                    ref={webcamRef}
                    audio={false}
                    onUserMedia={onUserMedia}
                    screenshotFormat="image/jpeg"
                    videoConstraints={{ facingMode: 'environment' }}
                    className={`absolute inset-0 w-full h-full object-cover transition-all duration-300 ${cloaked ? 'blur-3xl scale-110' : ''}`}
                />
            </div>
            {capture?.kind === 'photo' && <Image src={capture.uri} alt="preview" className="object-cover" fill sizes="100vw" unoptimized />}
            {capture?.kind === 'video' && <video src={capture.uri} className="absolute inset-0 w-full h-full object-cover" autoPlay loop muted playsInline />}
        </div>
    );
}

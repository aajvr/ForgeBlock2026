"""Static signature preprocessing (Chapter 3, Algorithm 2).

The same function is imported by the training scripts so that the model sees
identical inputs during training and in the web application.
"""
import cv2
import numpy as np

IMAGE_SIZE = 224
CROP_PADDING = 0.12


def decode_image(data: bytes) -> np.ndarray:
    """Decode uploaded bytes into a BGR image. Raises ValueError if unreadable."""
    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("The file is not a readable image (use PNG, JPG, BMP or TIFF).")
    return img


def _enhance_and_mask(img: np.ndarray):
    """Steps 1-8: returns the enhanced grayscale image, the Otsu ink mask
    (ink = 255) and the external contours."""
    if img.ndim == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)

    # 1. Grayscale
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    # 2-3. Illumination normalization: divide by a heavy blur of the background
    background = cv2.GaussianBlur(gray, (31, 31), 0)
    normalized = cv2.divide(gray, background, scale=255)
    # 4. Local contrast enhancement
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(normalized)
    # 5-6. High-pass filter to sharpen strokes
    high_pass = cv2.subtract(enhanced, cv2.GaussianBlur(enhanced, (9, 9), 0))
    sharpened = cv2.addWeighted(enhanced, 0.8, high_pass, 0.5, 0)
    # 7-8. Otsu threshold (ink becomes white) and contour detection
    _, mask = cv2.threshold(sharpened, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    return enhanced, mask, contours


def preprocess_signature(img: np.ndarray) -> np.ndarray:
    """Return a float32 array of shape (224, 224, 3) scaled to [-1, 1]."""
    enhanced, _, contours = _enhance_and_mask(img)

    # 9-14. Crop to the signature's bounding box with 12% padding
    cropped = enhanced
    if contours:
        x, y, w, h = cv2.boundingRect(np.vstack(contours))
        pw, ph = int(CROP_PADDING * w), int(CROP_PADDING * h)
        H, W = enhanced.shape
        x0, y0 = max(0, x - pw), max(0, y - ph)
        x1, y1 = min(W, x + w + pw), min(H, y + h + ph)
        if x1 > x0 and y1 > y0:
            cropped = enhanced[y0:y1, x0:x1]

    # 15-17. Resize, convert to 3-channel RGB, scale to [-1, 1]
    resized = cv2.resize(cropped, (IMAGE_SIZE, IMAGE_SIZE), interpolation=cv2.INTER_AREA)
    rgb = cv2.cvtColor(resized, cv2.COLOR_GRAY2RGB)
    return (rgb.astype(np.float32) - 127.5) / 127.5


def preprocessed_preview(img: np.ndarray) -> np.ndarray:
    """uint8 version of the preprocessed image, for showing in the UI."""
    arr = preprocess_signature(img)
    return np.clip(arr * 127.5 + 127.5, 0, 255).astype(np.uint8)


def ink_mask(img: np.ndarray) -> np.ndarray:
    """Binary ink mask (uint8, ink = 255) cropped tightly to the signature,
    with specks removed. Used for feature analysis and quality checks, not
    for the model input."""
    _, mask, _ = _enhance_and_mask(img)
    # Ignore specks of scanner noise.
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    min_area = max(4, int(0.00005 * mask.size))
    keep = np.zeros(n, bool)
    keep[1:] = stats[1:, cv2.CC_STAT_AREA] >= min_area
    clean = np.where(keep[labels], 255, 0).astype(np.uint8)
    ys, xs = np.nonzero(clean)
    if len(xs) == 0:
        return clean[:0, :0]
    return clean[ys.min(): ys.max() + 1, xs.min(): xs.max() + 1]

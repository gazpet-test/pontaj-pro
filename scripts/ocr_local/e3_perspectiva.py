"""Corecție opțională, numai pe foaie dovedită; pânza păstrează cadrul integral."""
import math


def perspectiva(image):
    try:
        import cv2
        import numpy as np
        from PIL import Image
    except ImportError:
        return image, 'nesigura'
    rgb = np.asarray(image.convert('RGB'))
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    edges = cv2.Canny(cv2.GaussianBlur(gray, (5, 5), 0), 50, 150)
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    h, w = gray.shape
    for contour in sorted(contours, key=cv2.contourArea, reverse=True):
        poly = cv2.approxPolyDP(contour, .02 * cv2.arcLength(contour, True), True)
        if len(poly) != 4 or not cv2.isContourConvex(poly):
            continue
        p = poly.reshape(4, 2).astype(np.float32)
        area = abs(cv2.contourArea(p)) / (w * h)
        if not .5 <= area <= .98 or np.any(p < 0) or np.any(p[:, 0] >= w) or np.any(p[:, 1] >= h):
            continue
        center = p.mean(axis=0)
        p = p[np.argsort(np.arctan2(p[:, 1] - center[1], p[:, 0] - center[0]))]
        p = np.roll(p, -np.argmin(p.sum(axis=1)), axis=0)
        angles = []
        for i in range(4):
            a, b = p[i - 1] - p[i], p[(i + 1) % 4] - p[i]
            angles.append(math.degrees(math.acos(float(np.clip(a.dot(b) / (np.linalg.norm(a) * np.linalg.norm(b)), -1, 1)))))
        if min(angles) < 60 or max(angles) > 120:
            continue
        mask = np.zeros_like(gray)
        cv2.fillConvexPoly(mask, p.astype(np.int32), 255)
        radius = max(1, round(.03 * min(w, h)))
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * radius + 1,) * 2)
        outer = (cv2.dilate(mask, kernel) > 0) & (mask == 0)
        if not outer.any() or np.median(gray[mask > 0]) - float(np.median(gray[outer])) < 25:
            continue
        # Échantillonnage uniforme du périmètre, avec tolérance de 2 px pour Canny.
        near_edge = cv2.dilate(edges, np.ones((5, 5), np.uint8))
        samples = []
        for i in range(4):
            a, b = p[i], p[(i + 1) % 4]
            samples.extend(np.linspace(a, b, max(2, int(np.linalg.norm(a - b)))))
        points = np.array(samples).astype(int)
        if np.mean(near_edge[points[:, 1], points[:, 0]] > 0) < .70:
            continue
        if max(abs(a - 90) for a in angles) <= 3:
            return image, 'inutila'
        tw = max(np.linalg.norm(p[0] - p[1]), np.linalg.norm(p[2] - p[3]))
        th = max(np.linalg.norm(p[1] - p[2]), np.linalg.norm(p[3] - p[0]))
        H = cv2.getPerspectiveTransform(p, np.float32([[0, 0], [tw, 0], [tw, th], [0, th]]))
        corners = np.float32([[[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]]])
        # Refuz dacă orizontul proiectiv intersectează cadrul original.
        den = np.array([H[2].dot([x, y, 1]) for x, y in corners[0]])
        if np.min(den) <= 0 <= np.max(den) or np.min(abs(den)) < 1e-6:
            continue
        mapped = cv2.perspectiveTransform(corners, H)[0]
        if not np.all(np.isfinite(mapped)):
            continue
        low, high = np.floor(mapped.min(axis=0)), np.ceil(mapped.max(axis=0))
        size = high - low + 1
        scale = min(1., math.sqrt(25000000 / float(size.prod())))
        T = np.array([[scale, 0, -low[0] * scale], [0, scale, -low[1] * scale], [0, 0, 1.]])
        output_size = tuple(np.maximum(1, np.floor(size * scale)).astype(int))
        out = cv2.warpPerspective(rgb, T @ H, output_size, borderValue=(255, 255, 255))
        return Image.fromarray(out), 'aplicata'
    return image, 'nesigura'

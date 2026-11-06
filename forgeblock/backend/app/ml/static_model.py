"""Static embedding model loaders.

Load order (first match wins), all files in backend/weights/:
  1. static_model.keras   - the team's trained Keras Siamese/embedding model
  2. static_encoder.pt    - a PyTorch encoder from training/train_static.py
  3. nothing found        - untrained PyTorch placeholder so the app still runs

Every loader exposes .embed(preprocessed) where `preprocessed` is the float32
(224, 224, 3) array produced by preprocessing.preprocess_signature, and
returns an L2-normalized 1-D numpy embedding.
"""
from pathlib import Path

import numpy as np

KERAS_FILENAME = "static_model.keras"
TORCH_FILENAME = "static_encoder.pt"


def _keras_custom_objects() -> dict:
    """Custom layers used when the team's model was saved."""
    import keras

    class L2NormalizationLayer(keras.layers.Layer):
        def call(self, inputs):
            return keras.ops.normalize(inputs, axis=-1, order=2)

    return {"L2NormalizationLayer": L2NormalizationLayer}


class KerasStaticModel:
    """Wraps a saved .keras model.

    Works with either an embedding model (one image in, one vector out) or a
    full Siamese model with two inputs, in which case the shared embedding
    sub-network is extracted automatically.
    """

    def __init__(self, path: Path):
        import keras  # imported lazily so TensorFlow is only needed with a .keras file

        model = keras.models.load_model(
            path, compile=False, safe_mode=False, custom_objects=_keras_custom_objects()
        )
        if len(model.inputs) > 1:
            model = self._extract_embedding(model)
        self.model = model
        shape = tuple(model.inputs[0].shape[1:])
        self.input_shape = shape  # e.g. (224, 224, 3) or (224, 224, 1)
        self.trained = True
        self.kind = "keras"
        self.source = path.name

    @staticmethod
    def _extract_embedding(siamese):
        import keras

        for layer in siamese.layers:
            if isinstance(layer, keras.Model) and len(layer.inputs) == 1:
                return layer
        raise ValueError(
            "The .keras file is a two-input Siamese model and its shared embedding "
            "sub-model could not be found. Save the embedding network on its own."
        )

    def _fit(self, x: np.ndarray) -> np.ndarray:
        h, w, c = (d if d is not None else s for d, s in zip(self.input_shape, x.shape))
        if (h, w) != x.shape[:2]:
            import cv2

            x = cv2.resize(x, (w, h), interpolation=cv2.INTER_AREA)
        if c == 1 and x.ndim == 3 and x.shape[2] == 3:
            x = x[..., :1]
        return x

    def embed(self, preprocessed: np.ndarray) -> np.ndarray:
        return self.embed_batch(np.expand_dims(preprocessed, 0))[0]

    def embed_batch(self, batch: np.ndarray) -> np.ndarray:
        """Embeds a stack of preprocessed images, shape (B, 224, 224, 3)."""
        x = np.stack([self._fit(b) for b in batch]).astype(np.float32)
        out = np.asarray(self.model(x, training=False), dtype=np.float64)
        return out / (np.linalg.norm(out, axis=1, keepdims=True) + 1e-12)


class TorchStaticModel:
    def __init__(self, path: Path | None):
        import torch

        from .networks import StaticEncoder

        self._torch = torch
        torch.manual_seed(0)  # deterministic placeholder embeddings
        self.model = StaticEncoder().eval()
        self.trained = path is not None
        if path is not None:
            state = torch.load(path, map_location="cpu", weights_only=True)
            self.model.load_state_dict(state.get("state_dict", state))
        self.kind = "pytorch" if self.trained else "placeholder"
        self.source = path.name if path else None

    def embed(self, preprocessed: np.ndarray) -> np.ndarray:
        return self.embed_batch(np.expand_dims(preprocessed, 0))[0]

    def embed_batch(self, batch: np.ndarray) -> np.ndarray:
        torch = self._torch
        with torch.inference_mode():
            x = torch.from_numpy(np.ascontiguousarray(batch, dtype=np.float32)).permute(0, 3, 1, 2)
            out = self.model(x).numpy().astype(np.float64)
        return out / (np.linalg.norm(out, axis=1, keepdims=True) + 1e-12)


def load_static_model(weights_dir: Path):
    keras_path = weights_dir / KERAS_FILENAME
    if keras_path.exists():
        return KerasStaticModel(keras_path)
    torch_path = weights_dir / TORCH_FILENAME
    return TorchStaticModel(torch_path if torch_path.exists() else None)

# [C110] FILES · config.py
"""Central configuration for the dynamic (online) signature-verification module.

Everything that can change between experiments / datasets lives in :class:`Config`.
Nothing downstream hardcodes dataset facts (number of users, 20/20 genuine/forgery,
which channels exist, feature dimension ...).
"""
from __future__ import annotations

import ast
import dataclasses
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, Tuple, Union

Flag = Union[str, bool]  # "auto" | True | False

# --------------------------------------------------------------------------- #
# Feature groups (names are the *model input channels*, in this order)
# --------------------------------------------------------------------------- #
BASE_FEATURES: Tuple[str, ...] = (
    "x", "y", "dx", "dy", "speed", "acc", "pen", "theta_sin", "theta_cos", "curvature",
)
ORIENTATION_FEATURES: Tuple[str, ...] = ("azimuth_sin", "azimuth_cos", "altitude")
PRESSURE_FEATURES: Tuple[str, ...] = ("pressure", "dpressure")

FEATURE_GROUPS: Dict[str, Tuple[str, ...]] = {
    "BASE": BASE_FEATURES,
    "ORIENTATION": ORIENTATION_FEATURES,
    "PRESSURE": PRESSURE_FEATURES,
}

#: raw channels a feature needs in order to be computable
FEATURE_REQUIRES: Dict[str, Tuple[str, ...]] = {
    **{f: ("x", "y", "t") for f in BASE_FEATURES},
    "pen": ("x", "y", "t", "button"),
    "azimuth_sin": ("azimuth",), "azimuth_cos": ("azimuth",), "altitude": ("altitude",),
    "pressure": ("pressure",), "dpressure": ("pressure", "t"),
}


def parse_flag(value: Any) -> Flag:
    """Parse ``"auto"``/``true``/``false`` style values (CLI friendly)."""
    if isinstance(value, bool):
        return value
    s = str(value).strip().lower()
    if s == "auto":
        return "auto"
    if s in {"true", "1", "yes", "on"}:
        return True
    if s in {"false", "0", "no", "off"}:
        return False
    raise ValueError(f"Cannot interpret {value!r} as one of: auto / true / false")


@dataclass
class Config:
    """All knobs of the pipeline. Create variants with :meth:`override`."""

    # ---- experiment / dataset -------------------------------------------------
    experiment: str = "E1"
    dataset: str = "svc2004"                 # key in data.registry ("svc2004", "svc_format_folder", "synthetic")
    tasks: Tuple[str, ...] = ("task1",)      # svc2004 only: ("task1",), ("task2",), ("task1", "task2")
    data_root: str = "data/raw"
    manifest_dir: str = "data/manifests"
    results_dir: str = "results"
    rebuild_manifest: bool = False
    strict_label_check: bool = True          # svc2004: fail loudly if the label convention does not hold

    # ---- generic "svc_format_folder" loader (own dataset) ----------------------
    folder_path: str = ""
    task_label: str = "custom"               # value of the manifest `task` column
    #: regex applied to the file name; needs groups `user` and `sample`
    #: (optionally `label` whose value is matched against the *_tokens below)
    filename_regex: str = r"U(?P<user>\d+)S(?P<sample>\d+)"
    genuine_ids: Tuple[int, int] = (1, 20)   # inclusive sample-id range -> genuine
    forgery_ids: Tuple[int, int] = (21, 40)  # inclusive sample-id range -> skilled forgery
    genuine_tokens: Tuple[str, ...] = ("g", "genuine")
    forgery_tokens: Tuple[str, ...] = ("f", "forgery", "skilled")

    # ---- feature selection -------------------------------------------------------
    use_pressure: Flag = "auto"
    use_orientation: Flag = "auto"
    channel_min_fraction: float = 0.9        # channel must be informative in >= this share of files

    # ---- preprocessing -------------------------------------------------------------
    T: int = 256                              # fixed number of time steps (or max steps in "rate" mode)
    resample_mode: str = "steps"              # "steps" (fixed T) | "rate" (fixed Hz, pad/truncate to T)
    rate_hz: float = 100.0
    scale_mode: str = "bbox"                  # "bbox" | "std"  (aspect ratio is always preserved)
    time_unit: str = "auto"                   # "auto" | "s" | "ms" | "us"
    smooth_window: int = 5                    # moving average before differentiation
    gap_factor: float = 5.0                   # dt > gap_factor * median(dt) is a pen-up gap
    min_points: int = 8

    # ---- augmentation (train only, off by default) ------------------------------------
    augment: bool = False
    aug_rotation_deg: float = 5.0
    aug_scale: float = 0.10
    aug_jitter: float = 0.003
    aug_timewarp: float = 0.15

    # ---- model ----------------------------------------------------------------------------
    conv_channels: Tuple[int, ...] = (64, 128)
    kernel_size: int = 5
    pool: int = 2
    dropout: float = 0.2
    lstm_hidden: int = 128
    lstm_layers: int = 1
    bidirectional: bool = True
    pooling: str = "attention"                # "attention" | "last" | "mean"
    embedding_dim: int = 64

    # ---- loss / distance -----------------------------------------------------------------------
    loss: str = "contrastive"                 # "contrastive" | "bce"
    metric: str = "euclidean"                 # "euclidean" | "cosine"
    margin: Any = None                        # None -> 1.0 (euclidean) / 0.5 (cosine)

    # ---- pairs ------------------------------------------------------------------------------------
    train_pos_pairs_per_user: int = 40        # negatives are matched 1:1 -> balanced
    train_random_ratio: float = 0.2           # share of negatives that are random forgeries
    eval_pairs_per_user: int = 100
    eval_random_ratio: float = 0.0

    # ---- training ---------------------------------------------------------------------------------------
    epochs: int = 60
    batch_size: int = 64
    lr: float = 1e-3
    weight_decay: float = 1e-4
    patience: int = 12
    grad_clip: float = 1.0
    num_workers: int = 0
    folds: int = 5
    val_fraction: float = 0.2                 # share of the non-test users used for validation
    seeds: Tuple[int, ...] = (0,)
    resume: bool = False

    # ---- protocols / thresholds ------------------------------------------------------------------------------
    n_enroll: int = 5
    enroll_repeats: int = 3
    enroll_aggregate: str = "mean"            # "mean" | "min"
    threshold_method: str = "eer"             # "eer" | "f1"  (always chosen on VALIDATION data)

    # ---- misc ---------------------------------------------------------------------------------------------------
    device: str = "auto"
    log_level: str = "INFO"
    make_plots: bool = True
    show_plots: bool = False

    # ------------------------------------------------------------------------------------------------------------
    def __post_init__(self) -> None:
        self.use_pressure = parse_flag(self.use_pressure)
        self.use_orientation = parse_flag(self.use_orientation)
        for name in ("tasks", "genuine_ids", "forgery_ids", "genuine_tokens", "forgery_tokens",
                     "conv_channels", "seeds"):
            setattr(self, name, tuple(getattr(self, name)))
        choices = {
            "resample_mode": ("steps", "rate"), "scale_mode": ("bbox", "std"),
            "time_unit": ("auto", "s", "ms", "us"), "pooling": ("attention", "last", "mean"),
            "loss": ("contrastive", "bce"), "metric": ("euclidean", "cosine"),
            "enroll_aggregate": ("mean", "min"), "threshold_method": ("eer", "f1"),
        }
        for key, allowed in choices.items():
            if getattr(self, key) not in allowed:
                raise ValueError(f"Config.{key}={getattr(self, key)!r} not in {allowed}")

    # ------------------------------------------------------------------------------------------------------------
    @property
    def effective_margin(self) -> float:
        if self.margin is not None:
            return float(self.margin)
        return 1.0 if self.metric == "euclidean" else 0.5

    def override(self, **kwargs: Any) -> "Config":
        """Return a copy with some fields replaced (unknown keys raise)."""
        valid = {f.name for f in dataclasses.fields(self)}
        bad = set(kwargs) - valid
        if bad:
            raise KeyError(f"Unknown config keys: {sorted(bad)}")
        return dataclasses.replace(self, **kwargs)

    def apply_experiment(self, experiment: str) -> "Config":
        """Apply the preset of experiment E1..E5 (other names are left as plain labels)."""
        preset = EXPERIMENTS.get(experiment, {})
        return self.override(experiment=experiment, **preset)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Config":
        valid = {f.name for f in dataclasses.fields(cls)}
        return cls(**{k: v for k, v in d.items() if k in valid})

    def save(self, path: Union[str, Path]) -> None:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_text(json.dumps(self.to_dict(), indent=2, default=str))


def parse_override(text: str) -> Tuple[str, Any]:
    """``"epochs=30"`` -> ``("epochs", 30)``; values go through ``ast.literal_eval``."""
    key, _, raw = text.partition("=")
    if not _:
        raise ValueError(f"Expected key=value, got {text!r}")
    try:
        return key.strip(), ast.literal_eval(raw)
    except (ValueError, SyntaxError):
        return key.strip(), raw


# --------------------------------------------------------------------------- #
# Experiment presets
# --------------------------------------------------------------------------- #
EXPERIMENTS: Dict[str, Dict[str, Any]] = {
    # E1: Task 1, BASE only
    "E1": dict(dataset="svc2004", tasks=("task1",), use_pressure=False, use_orientation=False),
    # E2: Task 2, BASE + ORIENTATION + PRESSURE (True => fail loudly if a channel is missing)
    "E2": dict(dataset="svc2004", tasks=("task2",), use_pressure=True, use_orientation=True),
    # E3: Task 2, BASE only (ablation that mimics our own data without pressure)
    "E3": dict(dataset="svc2004", tasks=("task2",), use_pressure=False, use_orientation=False),
    # E4 (optional): Task 1 + Task 2 pooled, BASE only
    "E4": dict(dataset="svc2004", tasks=("task1", "task2"), use_pressure=False, use_orientation=False),
    # E5 (extra): Task 2, BASE + PRESSURE (no orientation) -> isolates the pressure effect vs E3
    "E5": dict(dataset="svc2004", tasks=("task2",), use_pressure=True, use_orientation=False),
}

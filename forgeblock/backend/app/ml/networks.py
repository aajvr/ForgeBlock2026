"""Embedding networks for both modules.

StaticEncoder  - MobileNetV2 backbone + projection head (Section 3.3.2).
DynamicEncoder - Conv1D -> 2-layer BiLSTM(128) -> attention pooling -> FC(64)
                 (Sections 3.3.5 and 3.4.2).

Both return L2-normalized embeddings. A Siamese network is the same encoder
applied to the reference and the test input (shared weights).
"""
import torch
import torch.nn as nn
import torch.nn.functional as F

STATIC_EMBEDDING_DIM = 128
DYNAMIC_EMBEDDING_DIM = 64
DYNAMIC_FEATURES = 9
DYNAMIC_SEQ_LEN = 128


class StaticEncoder(nn.Module):
    def __init__(self, embedding_dim: int = STATIC_EMBEDDING_DIM, pretrained: bool = False):
        super().__init__()
        weights = "IMAGENET1K_V1" if pretrained else None
        # Imported here so the dynamic module does not load torchvision (it can
        # crash when TensorFlow is already loaded in the same process).
        from torchvision.models import mobilenet_v2

        self.backbone = mobilenet_v2(weights=weights).features  # -> (B, 1280, 7, 7)
        self.head = nn.Sequential(
            nn.Dropout(0.2),
            nn.Linear(1280, 512),
            nn.ReLU(inplace=True),
            nn.Linear(512, embedding_dim),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        feats = self.backbone(x)
        pooled = F.adaptive_avg_pool2d(feats, 1).flatten(1)
        return F.normalize(self.head(pooled), p=2, dim=1, eps=1e-8)


class DynamicEncoder(nn.Module):
    def __init__(
        self,
        in_features: int = DYNAMIC_FEATURES,
        conv_channels: int = 64,
        hidden: int = 128,
        embedding_dim: int = DYNAMIC_EMBEDDING_DIM,
    ):
        super().__init__()
        self.conv = nn.Sequential(
            nn.Conv1d(in_features, conv_channels, kernel_size=5, padding=2),
            nn.BatchNorm1d(conv_channels),
            nn.ReLU(inplace=True),
            nn.Conv1d(conv_channels, conv_channels, kernel_size=3, padding=1),
            nn.BatchNorm1d(conv_channels),
            nn.ReLU(inplace=True),
        )
        self.lstm = nn.LSTM(
            conv_channels, hidden, num_layers=2, batch_first=True, bidirectional=True, dropout=0.2
        )
        self.attn = nn.Linear(2 * hidden, 1, bias=False)
        self.fc = nn.Linear(2 * hidden, embedding_dim)

    def forward(self, x: torch.Tensor, mask: torch.Tensor | None = None) -> torch.Tensor:
        # x: (B, L, F); mask: (B, L) with 1 for valid time steps
        h = self.conv(x.transpose(1, 2)).transpose(1, 2)
        h, _ = self.lstm(h)
        scores = self.attn(h).squeeze(-1)
        if mask is not None:
            scores = scores.masked_fill(mask == 0, float("-inf"))
        alpha = torch.softmax(scores, dim=1)
        z = torch.sum(alpha.unsqueeze(-1) * h, dim=1)
        return F.normalize(self.fc(z), p=2, dim=1, eps=1e-8)


def contrastive_loss(e1: torch.Tensor, e2: torch.Tensor, same: torch.Tensor, margin: float = 1.0):
    """Contrastive loss on Euclidean distance between normalized embeddings.

    same = 1 for genuine-genuine pairs, 0 for genuine-forged pairs.
    """
    d = torch.norm(e1 - e2, p=2, dim=1)
    return torch.mean(same * d.pow(2) + (1 - same) * F.relu(margin - d).pow(2))

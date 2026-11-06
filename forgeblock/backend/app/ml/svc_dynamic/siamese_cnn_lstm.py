# [C220] FILES · models/siamese_cnn_lstm.py
"""Siamese network with a shared CNN-(Bi)LSTM encoder for online signatures."""
from __future__ import annotations

from typing import Optional

import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.nn.utils.rnn import pack_padded_sequence, pad_packed_sequence

from .config import Config


class CNNLSTMEncoder(nn.Module):
    """(B, T, F) + lengths -> L2-normalised embedding (B, embedding_dim).

    Conv1d blocks (Conv -> BatchNorm -> ReLU -> [Dropout] -> [MaxPool]) -> (Bi)LSTM ->
    pooling (attention | last | mean, all length-masked) -> Linear -> L2 norm.
    """

    def __init__(self, in_dim: int, cfg: Config):
        super().__init__()
        self.pool, self.pooling = cfg.pool, cfg.pooling
        blocks, c_in = [], in_dim
        for c_out in cfg.conv_channels:
            layers = [nn.Conv1d(c_in, c_out, cfg.kernel_size, padding=cfg.kernel_size // 2),
                      nn.BatchNorm1d(c_out), nn.ReLU()]
            if cfg.dropout > 0:
                layers.append(nn.Dropout(cfg.dropout))
            if cfg.pool > 1:
                layers.append(nn.MaxPool1d(cfg.pool))
            blocks.append(nn.Sequential(*layers))
            c_in = c_out
        self.blocks = nn.ModuleList(blocks)
        self.n_pool = len(blocks) if cfg.pool > 1 else 0
        self.lstm = nn.LSTM(c_in, cfg.lstm_hidden, cfg.lstm_layers, batch_first=True,
                            bidirectional=cfg.bidirectional,
                            dropout=cfg.dropout if cfg.lstm_layers > 1 else 0.0)
        h = cfg.lstm_hidden * (2 if cfg.bidirectional else 1)
        self.bidir = cfg.bidirectional
        self.attn = nn.Linear(h, 1) if cfg.pooling == "attention" else None
        self.drop = nn.Dropout(cfg.dropout)
        self.proj = nn.Linear(h, cfg.embedding_dim)

    def forward(self, x: torch.Tensor, lengths: torch.Tensor) -> torch.Tensor:
        h = x.transpose(1, 2)
        for blk in self.blocks:
            h = blk(h)
        h = h.transpose(1, 2)                                    # (B, T', C)
        Tp = h.size(1)
        lens = lengths.clone()
        for _ in range(self.n_pool):
            lens = torch.div(lens, self.pool, rounding_mode="floor")
        lens = lens.clamp(min=1, max=Tp)
        if bool((lens < Tp).any()):                              # variable-length batch (rate mode)
            pk = pack_padded_sequence(h, lens.cpu(), batch_first=True, enforce_sorted=False)
            out, (hn, _) = self.lstm(pk)
            out, _ = pad_packed_sequence(out, batch_first=True, total_length=Tp)
        else:
            out, (hn, _) = self.lstm(h)
        mask = torch.arange(Tp, device=h.device)[None, :] < lens[:, None]
        if self.pooling == "last":
            pooled = torch.cat([hn[-2], hn[-1]], -1) if self.bidir else hn[-1]
        elif self.pooling == "mean":
            pooled = (out * mask[..., None]).sum(1) / lens[:, None].to(out.dtype)
        else:
            w = self.attn(out).squeeze(-1).masked_fill(~mask, float("-inf"))
            pooled = (torch.softmax(w, 1)[..., None] * out).sum(1)
        return F.normalize(self.proj(self.drop(pooled)), dim=-1)


class SiameseCNNLSTM(nn.Module):
    """Two inputs -> SAME encoder (shared weights) -> distance / logit.

    ``pair_distance`` is "lower = more similar" for both losses: Euclidean or cosine distance for
    the contrastive loss, and ``-logit`` of a small head on ``|e1 - e2|`` for the BCE loss.
    """

    def __init__(self, in_dim: int, cfg: Config):
        super().__init__()
        self.metric, self.loss_type, self.margin = cfg.metric, cfg.loss, cfg.effective_margin
        self.encoder = CNNLSTMEncoder(in_dim, cfg)
        self.head: Optional[nn.Module] = None
        if cfg.loss == "bce":
            self.head = nn.Sequential(nn.Linear(cfg.embedding_dim, 32), nn.ReLU(), nn.Linear(32, 1))

    def encode(self, x: torch.Tensor, lengths: torch.Tensor) -> torch.Tensor:
        return self.encoder(x, lengths)

    def forward(self, xa, xb, la, lb):
        """Encode both branches in one pass (shared BN statistics) -> (ea, eb)."""
        e = self.encoder(torch.cat([xa, xb], 0), torch.cat([la, lb], 0))
        return e[: xa.size(0)], e[xa.size(0):]

    def pair_distance(self, ea: torch.Tensor, eb: torch.Tensor) -> torch.Tensor:
        """Works for any leading dims (..., E) -> (...)."""
        if self.loss_type == "bce":
            return -self.head((ea - eb).abs()).squeeze(-1)
        if self.metric == "cosine":
            return 1.0 - (ea * eb).sum(-1)
        return torch.sqrt(((ea - eb) ** 2).sum(-1) + 1e-12)

    def loss(self, ea: torch.Tensor, eb: torch.Tensor, y: torch.Tensor) -> torch.Tensor:
        """``y`` = 1 for genuine/same pairs, 0 for forgery/different pairs."""
        if self.loss_type == "bce":
            return F.binary_cross_entropy_with_logits(-self.pair_distance(ea, eb), y)
        d = self.pair_distance(ea, eb)
        return (y * d.pow(2) + (1 - y) * F.relu(self.margin - d).pow(2)).mean()

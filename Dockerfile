# VSCode AI Agent Dockerfile
# Multi-stage build for optimized image size

# Stage 1: Build stage
FROM node:18-bullseye-slim as builder

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    python3 \
    python3-pip \
    curl \
    wget \
    build-essential \
    libnss3-dev \
    libatk-bridge2.0-dev \
    libdrm2 \
    libxkbcommon-dev \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libxss1 \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /vscode

# Copy package files
COPY package*.json ./
COPY yarn.lock* ./

# Install Node.js dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Build VSCode with AI Agent
RUN npm run compile
RUN npm run compile-build

# Stage 2: Runtime stage
FROM node:18-bullseye-slim as runtime

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    git \
    python3 \
    python3-pip \
    curl \
    wget \
    libnss3 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libxss1 \
    libasound2 \
    libgtk-3-0 \
    libx11-xcb1 \
    libxcb-dri3-0 \
    libxcb-dri2-0 \
    libxcb-glx0 \
    libxcb-present0 \
    libxcb-sync1 \
    libxcb-xfixes0 \
    libxshmfence1 \
    && rm -rf /var/lib/apt/lists/*

# Install Ollama
RUN curl -fsSL https://ollama.ai/install.sh | sh

# Install Python dependencies for AI models
RUN pip3 install \
    torch \
    transformers \
    accelerate \
    sentence-transformers \
    chromadb \
    faiss-cpu \
    pinecone-client \
    weaviate-client \
    redis \
    graphrag \
    langchain \
    openai \
    anthropic \
    google-cloud-aiplatform

# Create vscode user
RUN useradd -m -s /bin/bash vscode

# Set working directory
WORKDIR /home/vscode

# Copy built application from builder stage
COPY --from=builder /vscode /home/vscode/vscode
COPY --from=builder /vscode/package*.json /home/vscode/

# Install production dependencies
RUN npm ci --only=production

# Create necessary directories
RUN mkdir -p \
    /home/vscode/.vscode/extensions \
    /home/vscode/.vscode/data \
    /home/vscode/.ollama \
    /home/vscode/models \
    /home/vscode/workspace \
    /home/vscode/.cache/huggingface \
    /home/vscode/.cache/torch

# Set permissions
RUN chown -R vscode:vscode /home/vscode

# Switch to vscode user
USER vscode

# Set environment variables
ENV HOME=/home/vscode
ENV OLLAMA_HOST=0.0.0.0:11434
ENV HF_HOME=/home/vscode/.cache/huggingface
ENV TORCH_HOME=/home/vscode/.cache/torch
ENV PYTHONPATH=/home/vscode/vscode/src:$PYTHONPATH

# Expose ports
EXPOSE 3000 11434 9229

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Default command
CMD ["node", "/home/vscode/vscode/out/main.js", "--no-sandbox", "--disable-dev-shm-usage"]

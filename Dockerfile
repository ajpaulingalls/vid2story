# Use Rust as base image and install Node.js
FROM rust:latest

# Set environment variables
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV LAND2PORT_PATH="/rust-project"
ENV PORT=3000
ENV NODE_ENV=production

# Install system dependencies including Node.js
RUN apt-get update && apt-get install -y \
    curl \
    build-essential \
    git \
    git-lfs \
    python3 \
    libavutil-dev \
    libavcodec-dev \
    libavformat-dev \
    libavfilter-dev \
    libavdevice-dev \
    libclang-dev \
    libssl3 \
    libssl-dev \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js using NodeSource repository
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs

# Install pnpm
RUN npm install -g pnpm

# Clone and build the Rust project
WORKDIR /rust-project
RUN git clone https://github.com/paulingalls/land2port .
RUN cargo build --release

# Set up the Node.js application
WORKDIR /app
COPY . .

# Install dependencies and build
RUN pnpm install --frozen-lockfile
RUN pnpm run build
RUN pnpm run db:migrate

# Expose port
EXPOSE 3000

# Start the application
CMD [ "pnpm", "start" ]
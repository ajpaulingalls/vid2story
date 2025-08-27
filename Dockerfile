# --- Stage 1: Build the Rust executable ---
    FROM rust:latest AS rust_builder
    WORKDIR /rust-project
    
    # Install git, needed to clone the repository
    RUN apt-get update && apt-get install -y git
    RUN apt-get install -y python3
    
    # Clone the Rust project from GitHub and build it
    RUN git clone https://github.com/paulingalls/land2port .
    RUN cargo build --release
    
    # --- Stage 2: Create the final Node.js image ---
    FROM node:22-slim AS base
    ENV PNPM_HOME="/pnpm"
    ENV PATH="$PNPM_HOME:$PATH"
    ENV LAND2PORT_PATH="/rust-project"
    ENV PORT=3000
    ENV NODE_ENV=production
    RUN corepack enable
    COPY . /app
    WORKDIR /app
    
    FROM base AS prod-deps
    RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod --frozen-lockfile
    
    FROM base AS build
    RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
    RUN pnpm run build
    
    FROM base
    COPY --from=prod-deps /app/node_modules /app/node_modules
    COPY --from=build /app/dist /app/dist
    EXPOSE 3000
    CMD [ "pnpm", "start" ]
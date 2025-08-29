# VM Setup Guide for vid2story

This guide provides step-by-step instructions for setting up a virtual machine to run the vid2story application.

## Prerequisites

- Ubuntu 22.04 LTS VM
- Azure VM with sufficient storage and compute resources
- Root/sudo access

## 1. System Updates and Package Installation

Update the system and install essential packages:

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y git-lfs
sudo apt install -y build-essential pkg-config libclang-dev
sudo apt install -y libssl-dev ca-certificates
sudo apt install -y libavutil-dev libavcodec-dev libavformat-dev libavfilter-dev libavdevice-dev
```

## 2. Data Drive Setup

Mount and configure a dedicated data drive for the application:

```bash
# List available block devices
lsblk

# Create GPT partition table
sudo parted /dev/sda mklabel gpt

# Create primary partition using entire disk
sudo parted -a opt /dev/sda mkpart primary ext4 0% 100%

# Format partition with ext4 filesystem
sudo mkfs.ext4 /dev/sda1

# Verify partition creation
lsblk

# Create mount point
sudo mkdir /datadrive

# Mount the partition
sudo mount /dev/sda1 /datadrive

# Get UUID for fstab configuration
sudo blkid /dev/sda1

# Edit fstab to add permanent mount
sudo vi /etc/fstab
```

Add this line to `/etc/fstab` (replace `<your-disk-uuid>` with the actual UUID):

```
UUID=<your-disk-uuid> /datadrive ext4 defaults,nofail 0 0
```

Complete the mount setup:

```bash
# Test fstab configuration
sudo mount -a

# Set ownership to azureuser
sudo chown azureuser:azureuser /datadrive
```

## 3. Rust and land2port Installation

Install Rust and the land2port utility:

```bash
cd /datadrive

# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Source Rust environment
. "$HOME/.cargo/env"

# Clone and build land2port
git clone https://github.com/paulingalls/land2port.git
cd land2port/
cargo build --release
```

## 4. Node.js and vid2story Setup

Install Node.js and deploy the vid2story application:

```bash
cd /datadrive

# Clone the repository
git clone https://github.com/ajpaulingalls/vid2story.git
cd vid2story

# Install Node Version Manager (nvm)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash

# Install LTS version of Node.js
nvm install --lts

# Install pnpm package manager
npm install -g pnpm

# Install dependencies and build
pnpm install
pnpm build

# Run database migrations
pnpm db:migrate

# Create uploads directory
mkdir uploads

# Configure environment
cp .env.example .env
vi .env
```

## 5. Nginx Configuration

Set up Nginx as a reverse proxy for the Node.js application:

```bash
# Install Nginx
sudo apt install -y nginx

# Create site configuration
sudo vi /etc/nginx/sites-available/vid2story.conf
```

Add the following configuration to `/etc/nginx/sites-available/vid2story.conf`:

```nginx
server {
    listen 80;
    server_name vid2story.eastus.cloudapp.azure.com; # Replace with your domain or server IP
    client_max_body_size 3G;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # Optional: Serve static files directly with Nginx for performance
    # location /static/ {
    #     alias /path/to/your/nodejs/app/public/;
    #     expires 30d;
    #     add_header Cache-Control "public";
    # }
}
```

Enable the site and restart Nginx:

```bash
# Create symbolic link
sudo ln -s /etc/nginx/sites-available/vid2story.conf /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx
```

## 6. CUDA and TensorRT Installation

Install CUDA toolkit and TensorRT for GPU acceleration:

```bash
cd /datadrive
mkdir cuda
cd cuda

# Download and install CUDA keyring
wget https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2204/x86_64/cuda-keyring_1.1-1_all.deb
sudo dpkg -i cuda-keyring_1.1-1_all.deb

# Update package list and install CUDA components
sudo apt update
sudo apt install -y cuda-toolkit-12 tensorrt cudnn
```

## 7. NVIDIA Driver Setup

**Note:** This section requires additional configuration to ensure NVIDIA drivers are properly recognized by CUDA. The specific steps may vary depending on your VM configuration and GPU setup.

## Next Steps

After completing the setup:

1. Configure your `.env` file with appropriate API keys and settings
2. Start the vid2story application: `pnpm start`
3. Verify the application is accessible through Nginx
4. Test GPU acceleration if applicable

## Troubleshooting

- Check Nginx error logs: `sudo tail -f /var/log/nginx/error.log`
- Verify application logs for any startup issues
- Ensure all required environment variables are set in `.env`
- Check firewall settings if the application is not accessible externally

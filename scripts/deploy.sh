#!/bin/bash

# VSCode AI Agent Deployment Script
# This script deploys the complete AI-powered coding agent system

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_NAME="vscode-agent"
DOCKER_REGISTRY="your-registry.com"
TAG=${1:-"latest"}
ENVIRONMENT=${2:-"development"}

echo -e "${BLUE}🚀 Deploying VSCode AI Agent${NC}"
echo "Environment: $ENVIRONMENT"
echo "Tag: $TAG"
echo

# Function to print status messages
print_status() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

# Pre-deployment checks
echo -e "${BLUE}🔍 Running pre-deployment checks...${NC}"

# Check if Docker is running
if ! docker info >/dev/null 2>&1; then
    print_error "Docker is not running. Please start Docker and try again."
    exit 1
fi

# Check if docker-compose is available
if ! command -v docker-compose >/dev/null 2>&1; then
    print_error "docker-compose is not installed. Please install it and try again."
    exit 1
fi

# Check if required files exist
required_files=("Dockerfile" "docker-compose.yml" "package.json")
for file in "${required_files[@]}"; do
    if [ ! -f "$file" ]; then
        print_error "Required file '$file' not found."
        exit 1
    fi
done

print_status "Pre-deployment checks passed"

# Build the application
echo -e "${BLUE}🔨 Building VSCode AI Agent...${NC}"

# Build Docker images
docker-compose build --no-cache
print_status "Docker images built successfully"

# Tag images for registry
if [ "$DOCKER_REGISTRY" != "your-registry.com" ]; then
    echo -e "${BLUE}🏷️ Tagging images for registry...${NC}"
    docker tag ${PROJECT_NAME}_vscode-agent:latest ${DOCKER_REGISTRY}/${PROJECT_NAME}/vscode-agent:${TAG}
    docker tag ${PROJECT_NAME}_api-gateway:latest ${DOCKER_REGISTRY}/${PROJECT_NAME}/api-gateway:${TAG}
    print_status "Images tagged for registry"
fi

# Deploy based on environment
case $ENVIRONMENT in
    "development")
        echo -e "${BLUE}🛠️ Starting development environment...${NC}"
        docker-compose up -d
        print_status "Development environment started"
        ;;

    "staging")
        echo -e "${BLUE}🧪 Deploying to staging...${NC}"

        # Create staging-specific environment file
        cat > .env.staging << EOF
NODE_ENV=staging
OLLAMA_HOST=0.0.0.0:11434
VSCODE_AGENT_MODELS=auto
VSCODE_AGENT_MEMORY=hybrid
VSCODE_AGENT_APIS=all
EOF

        # Deploy with staging configuration
        docker-compose --env-file .env.staging up -d
        print_status "Staging deployment completed"
        ;;

    "production")
        echo -e "${BLUE}🚀 Deploying to production...${NC}"

        # Create production-specific environment file
        cat > .env.production << EOF
NODE_ENV=production
OLLAMA_HOST=0.0.0.0:11434
VSCODE_AGENT_MODELS=optimized
VSCODE_AGENT_MEMORY=hybrid
VSCODE_AGENT_APIS=all
EOF

        # Pull latest images if using registry
        if [ "$DOCKER_REGISTRY" != "your-registry.com" ]; then
            docker-compose pull
        fi

        # Deploy with production configuration
        docker-compose --env-file .env.production up -d
        print_status "Production deployment completed"
        ;;

    *)
        print_error "Unknown environment: $ENVIRONMENT"
        print_error "Supported environments: development, staging, production"
        exit 1
        ;;
esac

# Wait for services to be healthy
echo -e "${BLUE}⏳ Waiting for services to start...${NC}"
sleep 30

# Health check
echo -e "${BLUE}🔍 Running health checks...${NC}"

# Check if main service is healthy
if curl -f http://localhost:3000/health >/dev/null 2>&1; then
    print_status "VSCode Agent is healthy"
else
    print_warning "VSCode Agent health check failed"
fi

# Check Ollama
if curl -f http://localhost:11434/api/tags >/dev/null 2>&1; then
    print_status "Ollama is healthy"
else
    print_warning "Ollama health check failed"
fi

# Check Redis
if docker-compose exec -T redis redis-cli ping | grep -q PONG; then
    print_status "Redis is healthy"
else
    print_warning "Redis health check failed"
fi

# Check PostgreSQL
if docker-compose exec -T postgres pg_isready -U vscode >/dev/null 2>&1; then
    print_status "PostgreSQL is healthy"
else
    print_warning "PostgreSQL health check failed"
fi

# Post-deployment setup
echo -e "${BLUE}⚙️ Running post-deployment setup...${NC}"

# Pull default Ollama models
echo "Pulling default Ollama models..."
docker-compose exec vscode-agent ollama pull llama2:7b >/dev/null 2>&1 && print_status "Llama2 model pulled" || print_warning "Failed to pull Llama2 model"
docker-compose exec vscode-agent ollama pull codellama:7b >/dev/null 2>&1 && print_status "CodeLlama model pulled" || print_warning "Failed to pull CodeLlama model"

# Initialize database
echo "Initializing database..."
docker-compose exec vscode-agent npm run db:init >/dev/null 2>&1 && print_status "Database initialized" || print_warning "Database initialization failed"

print_status "Post-deployment setup completed"

# Display service information
echo
echo -e "${GREEN}🎉 Deployment completed successfully!${NC}"
echo
echo -e "${BLUE}📋 Service Information:${NC}"
echo "VSCode Agent:     http://localhost:3000"
echo "Ollama API:       http://localhost:11434"
echo "Redis:           localhost:6379"
echo "PostgreSQL:      localhost:5432"
echo "ChromaDB:        http://localhost:8000"
echo "Weaviate:        http://localhost:8080"
echo "Grafana:         http://localhost:3001 (admin/admin)"
echo "Prometheus:      http://localhost:9090"
echo

# Display useful commands
echo -e "${BLUE}🔧 Useful Commands:${NC}"
echo "View logs:        docker-compose logs -f"
echo "Stop services:    docker-compose down"
echo "Restart service:  docker-compose restart vscode-agent"
echo "Update models:    docker-compose exec vscode-agent ollama pull <model>"
echo "Access shell:     docker-compose exec vscode-agent bash"
echo

print_status "Deployment script completed"

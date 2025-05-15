#!/bin/bash

# Write initial messages directly to the terminal
echo "🚀 Cloudflare Terraform Setup Script" > /dev/tty
echo "This script will help you configure your terraform.tfvars file for Cloudflare" > /dev/tty
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" > /dev/tty

# Function to read YAML value from a file
get_yaml_value() {
    local file="$1"
    local key="$2"
    local section="$3"
    if [ -n "$section" ]; then
        # Read from a specific section (e.g., config or repos)
        sed -n "/^$section:/,/^[a-z]/p" "$file" | grep "^  $key:" | cut -d':' -f2 | tr -d ' "'
    else
        # Read from root level
        grep "^$key:" "$file" | cut -d':' -f2 | tr -d ' "'
    fi
}

# Function to get value from either config file, with project config taking precedence
get_config_value() {
    local global_file="$1"
    local project_file="$2"
    local key="$3"
    local section="$4"
    
    # Try to get value from project config first
    local project_value=$(get_yaml_value "$project_file" "$key" "$section")
    if [ -n "$project_value" ]; then
        echo "$project_value"
        return
    fi
    
    # If not found in project config, try global config
    local global_value=$(get_yaml_value "$global_file" "$key" "$section")
    if [ -n "$global_value" ]; then
        echo "$global_value"
        return
    fi
    
    # If not found in either, return empty
    echo ""
}

# Parse command line arguments
GLOBAL_CONFIG_FILE=""
PROJECT_CONFIG_FILE=""
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --global-config) GLOBAL_CONFIG_FILE="$2"; shift ;;
        --project-config) PROJECT_CONFIG_FILE="$2"; shift ;;
        *) echo "Unknown parameter: $1" > /dev/tty; exit 1 ;;
    esac
    shift
done

# Check if config files exist
if [ -z "$GLOBAL_CONFIG_FILE" ] || [ ! -f "$GLOBAL_CONFIG_FILE" ]; then
    echo "❌ Error: Global configuration file not found" > /dev/tty
    exit 1
fi

if [ -z "$PROJECT_CONFIG_FILE" ] || [ ! -f "$PROJECT_CONFIG_FILE" ]; then
    echo "❌ Error: Project configuration file not found" > /dev/tty
    exit 1
fi

# Create terraform directory if it doesn't exist
mkdir -p static-devops/terraform

# Clear or create terraform.tfvars
> static-devops/terraform/terraform.tfvars

# Read values from both config files
app_name=$(get_config_value "$GLOBAL_CONFIG_FILE" "$PROJECT_CONFIG_FILE" "app_name" "config")
cloudflare_api_key=$(get_config_value "$GLOBAL_CONFIG_FILE" "$PROJECT_CONFIG_FILE" "cloudflare_api_key" "config")
cloudflare_account_id=$(get_config_value "$GLOBAL_CONFIG_FILE" "$PROJECT_CONFIG_FILE" "cloudflare_account_id" "config")
domains=$(get_config_value "$GLOBAL_CONFIG_FILE" "$PROJECT_CONFIG_FILE" "domains" "config")

# Check if subdomain configuration exists
if [ -n "$(get_config_value "$PROJECT_CONFIG_FILE" "" "cloudflare_zone_id" "config")" ]; then
  subdomain_name=$(get_config_value "$PROJECT_CONFIG_FILE" "" "subdomain_name" "config")
  subdomain_zone_id=$(get_config_value "$PROJECT_CONFIG_FILE" "" "cloudflare_zone_id" "config")
  subdomain_type=$(get_config_value "$PROJECT_CONFIG_FILE" "" "subdomain_type" "config")
  subdomain_value=$(get_config_value "$PROJECT_CONFIG_FILE" "" "subdomain_value" "config")
  
  # Write the captured values into terraform.tfvars with subdomain
  cat << EOF > static-devops/terraform/terraform.tfvars
app_name = "${app_name}"
cloudflare_api_key = "${cloudflare_api_key}"
cloudflare_account_id = "${cloudflare_account_id}"
domains = [$(echo $domains | sed 's/,/","/g' | sed 's/.*/"&"/')]
subdomain = {
  name    = "${subdomain_name}"
  zone_id = "${subdomain_zone_id}"
  type    = "${subdomain_type}"
  value   = "${subdomain_value}"
}
EOF
else
  # Write the captured values into terraform.tfvars without subdomain
  cat << EOF > static-devops/terraform/terraform.tfvars
app_name = "${app_name}"
cloudflare_api_key = "${cloudflare_api_key}"
cloudflare_account_id = "${cloudflare_account_id}"
domains = [$(echo $domains | sed 's/,/","/g' | sed 's/.*/"&"/')]
EOF
fi

echo "✅ terraform.tfvars has been created successfully!" > /dev/tty
echo "📁 Location: static-devops/terraform/terraform.tfvars" > /dev/tty
echo "🔒 Note: This file contains sensitive information. Make sure it's git-ignored!" > /dev/tty

# Run terraform init
echo "🚀 Running terraform init..." > /dev/tty
terraform -chdir=static-devops/terraform init

# Run terraform apply
echo "🚀 Running terraform apply..." > /dev/tty
terraform -chdir=static-devops/terraform apply -auto-approve

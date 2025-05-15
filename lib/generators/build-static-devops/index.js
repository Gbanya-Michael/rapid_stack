const Generator = require("yeoman-generator");
const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");
const {
  handlePrompt,
  getConfigField,
  validateRequiredFields,
} = require("../../lib/utils");
const BaseGenerator = require("../base");

module.exports = class extends BaseGenerator {
  constructor(args, opts) {
    super(args, opts);

    // Add debug option
    this.option("debug", {
      desc: "Enable debug mode",
      type: Boolean,
      default: false,
    });

    // Track modified files
    this.modifiedFiles = [];

    // Initialize prompting flag
    this._isPromptingComplete = false;
  }

  async initializing() {
    // Check if --rm flag is present
    if (this.options.rm) {
      const appName = getConfigField("config.app_name");
      if (!appName) {
        this.log("\n" + "=".repeat(80));
        this.log("❌ Could not find project name in .rapidrc!");
        this.log("=".repeat(80));
        this.log(
          "\nPlease ensure your .rapidrc file contains a valid config.app_name field."
        );
        this.log("\n" + "=".repeat(80) + "\n");
        process.exit(1);
      }

      try {
        this.log("\nDestroying Cloudflare infrastructure...");
        execSync("rapid run:static-devops --rm", { stdio: "inherit" });
        this.log("✓ Cloudflare infrastructure destroyed successfully");
      } catch (error) {
        this.log.error(
          "\n❌ Error destroying Cloudflare infrastructure:",
          error.message
        );
        process.exit(1);
      }

      // Ask about local project
      const localAnswer = await this.prompt([
        {
          type: "confirm",
          name: "confirm",
          message: `Do you want to remove the static-devops folder?`,
          default: false,
        },
      ]);

      if (localAnswer.confirm) {
        // Remove the static-devops directory
        try {
          const projectDir = path.join(process.cwd(), "static-devops");
          if (fs.existsSync(projectDir)) {
            fs.rmSync(projectDir, { recursive: true, force: true });
            this.log("✓ Removed static-devops directory");
          } else {
            this.log("static-devops directory not found.");
          }
          process.exit(0);
        } catch (error) {
          this.log.error(
            "\n❌ Error removing static-devops directory:",
            error.message
          );
          process.exit(1);
        }
      }
      this.log("🚀 Clean up completed...");
      process.exit(0);
    }

    // Validate required fields
    validateRequiredFields([
      "config.cloudflare_api_key",
      "config.cloudflare_account_id",
      "config.github_username",
      "config.repo_access_token",
    ]);

    // Prompt user: domain or subdomain
    const { isSubdomain } = await this.prompt([
      {
        type: "confirm",
        name: "isSubdomain",
        message:
          "Do you want to create a subdomain (instead of a root domain)?",
        default: false,
      },
    ]);

    if (isSubdomain) {
      // Prompt for subdomain info
      const subdomainAnswers = await this.prompt([
        {
          type: "input",
          name: "parentDomain",
          message: "Enter the parent domain (e.g., example.com):",
          validate: (input) => (input ? true : "Parent domain is required."),
        },
        {
          type: "input",
          name: "zone_id",
          message: "Enter the Cloudflare Zone ID for the parent domain:",
          validate: (input) => (input ? true : "Zone ID is required."),
        },
        {
          type: "input",
          name: "name",
          message: "Enter the subdomain name (e.g., api for api.example.com):",
          validate: (input) => (input ? true : "Subdomain name is required."),
        },

        {
          type: "list",
          name: "type",
          message: "DNS record type:",
          choices: ["CNAME", "A"],
          default: "CNAME",
        },
        {
          type: "input",
          name: "value",
          message:
            "DNS record value (e.g., example.com for CNAME, or IP for A):",
          validate: (input) => (input ? true : "Record value is required."),
        },
      ]);

      // Save credentials to .rapidrc
      const rapidrcPath = path.join(process.cwd(), ".rapidrc");
      let config = {};
      let originalContent = "";
      if (fs.existsSync(rapidrcPath)) {
        const yaml = require("yaml");
        originalContent = fs.readFileSync(rapidrcPath, "utf8");
        config = yaml.parse(originalContent) || {};
      }
      if (!config.config) config.config = {};

      // Update only the specific fields
      config.config.cloudflare_zone_id = subdomainAnswers.zone_id;
      config.config.parent_domain = subdomainAnswers.parentDomain;
      config.config.subdomain_name = subdomainAnswers.name;
      config.config.subdomain_type = subdomainAnswers.type;
      config.config.subdomain_value = subdomainAnswers.value;
      // Update domains to use parent domain
      config.config.domains = subdomainAnswers.parentDomain;

      // Write back to .rapidrc preserving exact format
      const yaml = require("yaml");
      const yamlOptions = {
        indent: 2,
        lineWidth: 0,
        noRefs: true,
        sortKeys: false,
      };

      // If we have original content, preserve everything before the config section
      if (originalContent) {
        const headerComments = originalContent.split(
          "# Project Configuration"
        )[0];
        const newContent = yaml.stringify(config, yamlOptions);
        fs.writeFileSync(
          rapidrcPath,
          headerComments + "# Project Configuration\n" + newContent,
          "utf8"
        );
      } else {
        // If no original content, use the template format
        const headerComments = `# ⚠️ WARNING: This is a local configuration file that overrides the global config
# Do not edit this file manually unless you understand the implications
# This file is automatically managed by Rapid Stack generators
# Any values set here will override the global configuration in ~/.rapid_stack/config.yml
# The global config is meant to be shared across multiple projects
# Only modify this file if you need project-specific overrides

`;
        const newContent = yaml.stringify(config, yamlOptions);
        fs.writeFileSync(
          rapidrcPath,
          headerComments + "# Project Configuration\n" + newContent,
          "utf8"
        );
      }
      this.log("Saved subdomain credentials to .rapidrc.");

      // Write to terraform.tfvars
      const tfvarsPath = path.join(
        process.cwd(),
        "static-devops",
        "terraform",
        "terraform.tfvars"
      );
      // Ensure the directory exists before writing
      fs.mkdirSync(path.dirname(tfvarsPath), { recursive: true });
      const tfvarsContent = `subdomain = {\n  name    = \"${subdomainAnswers.name}.${subdomainAnswers.parentDomain}\"\n  zone_id = \"${subdomainAnswers.zone_id}\"\n  type    = \"${subdomainAnswers.type}\"\n  value   = \"${subdomainAnswers.value}\"\n}\n`;
      fs.writeFileSync(tfvarsPath, tfvarsContent, "utf8");
      this.log("Wrote subdomain info to terraform.tfvars.");
    }
  }

  destinationPath(...paths) {
    // First call the parent's destinationPath to get the base path
    const basePath = super.destinationPath(...paths);

    // Only prepend project name if:
    // 1. We have answers (prompting phase is complete)
    // 2. We have a project name
    // 3. The path doesn't already include the project name
    // 4. We're not in the initial setup phase
    if (
      this.answers?.projectName &&
      !basePath.includes(this.answers.projectName) &&
      this._isPromptingComplete
    ) {
      // Prepend the project name to the path
      return path.join(process.cwd(), this.answers.projectName, ...paths);
    }

    return basePath;
  }

  async prompting() {
    // Set default project name to 'devops'
    this.answers = {
      projectName: "static-devops",
    };

    // Set flag indicating prompting is complete
    this._isPromptingComplete = true;
  }

  async configuring() {
    const { projectName } = this.answers;
    const projectPath = path.join(process.cwd(), projectName);

    // Check if project exists
    if (fs.existsSync(projectPath)) {
      const { action } = await handlePrompt(this, [
        {
          type: "list",
          name: "action",
          message:
            "Project directory already exists. What would you like to do?",
          choices: [
            { name: "Update existing project", value: "update" },
            { name: "Cancel installation", value: "cancel" },
          ],
        },
      ]);

      if (action === "cancel") {
        this.log("Installation cancelled.");
        process.exit(0);
      }
    }
  }

  async _setupProjectDirectory() {
    const { projectName } = this.answers;
    const projectPath = path.join(process.cwd(), projectName);

    if (!fs.existsSync(projectPath)) {
      const { confirmCreate } = await handlePrompt(this, [
        {
          type: "confirm",
          name: "confirmCreate",
          message: `This will create a new devops project in: ${projectPath}\nAre you sure you want to continue?`,
          default: false,
        },
      ]);

      if (!confirmCreate) {
        this.log("Installation cancelled.");
        process.exit(0);
      }

      fs.mkdirSync(projectPath, { recursive: true });
      this.log("✓ Created project directory");
    } else {
      this.log("Using existing project directory");
    }
  }

  async _copyTemplateFile(templatePath, destinationPath, templateData) {
    try {
      // Get the full template path. It may return an array if multiple files match.
      const templateFullPath = this.templatePath(templatePath);
      // If it's an array, pick the first file.
      const src = Array.isArray(templateFullPath)
        ? templateFullPath[0]
        : templateFullPath;

      // Get the destination path within the project directory
      // Remove .erb extension from destination path if it exists
      const finalDestinationPath = destinationPath.endsWith(".erb")
        ? destinationPath.slice(0, -4)
        : destinationPath;
      const destinationFullPath = this.destinationPath(finalDestinationPath);

      // Ensure destination directory exists
      const destDir = path.dirname(destinationFullPath);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
        this._debugLog(`Created directory: ${destDir}`);
      }

      // Copy the template file with provided context
      this.fs.copyTpl(src, destinationFullPath, templateData);

      // Force write to disk immediately
      await new Promise((resolve, reject) => {
        this.fs.commit((err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // If the final destination file is a shell script, make it executable
      if (finalDestinationPath.endsWith(".sh")) {
        try {
          fs.chmodSync(destinationFullPath, "755");
          this._debugLog(`Made ${finalDestinationPath} executable`);
        } catch (error) {
          this.log(
            `Warning: Could not make ${finalDestinationPath} executable: ${error.message}`
          );
        }
      }

      this.modifiedFiles.push(finalDestinationPath);
      this._debugLog(
        `Copied template ${templatePath} to ${destinationFullPath}`
      );
    } catch (error) {
      this.log(`Error copying template ${templatePath}: ${error.message}`);
      if (this.options.debug) {
        this.log("Stack trace:", error.stack);
      }
      throw error;
    }
  }

  async _readme() {
    this._copyTemplateFile("README.md.erb", "README.md", {});
    this.log("✓ README created");
  }

  async _setupTerraform() {
    const { confirmTerraform } = await handlePrompt(this, [
      {
        type: "confirm",
        name: "confirmTerraform",
        message: "Would you like to set up Terraform configuration?",
        default: true,
      },
    ]);

    if (confirmTerraform) {
      try {
        // Create terraform directory
        const terraformPath = this.destinationPath("terraform");
        if (!fs.existsSync(terraformPath)) {
          fs.mkdirSync(terraformPath, { recursive: true });
          this.log("✓ Terraform directory created");
        }

        // Get source and destination paths
        const sourcePath = this.templatePath("terraform");
        const destPath = this.destinationPath("terraform");

        // Function to recursively copy files
        const copyFilesRecursively = async (sourceDir, destDir) => {
          const entries = fs.readdirSync(sourceDir, { withFileTypes: true });

          for (const entry of entries) {
            const sourcePath = path.join(sourceDir, entry.name);
            const destPath = path.join(destDir, entry.name);

            if (entry.isDirectory()) {
              // Create directory and recurse
              if (!fs.existsSync(destPath)) {
                fs.mkdirSync(destPath, { recursive: true });
              }
              await copyFilesRecursively(sourcePath, destPath);
            } else {
              // Copy file
              const relativePath = path.relative(
                this.templatePath("terraform"),
                sourcePath
              );
              this._copyTemplateFile(
                `terraform/${relativePath}`,
                `terraform/${relativePath}`,
                {}
              );
            }
          }
        };

        // Get total number of files and directories for progress tracking
        const countItems = (dir) => {
          let count = 0;
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            count++;
            if (entry.isDirectory()) {
              count += countItems(path.join(dir, entry.name));
            }
          }
          return count;
        };

        const totalItems = countItems(sourcePath);
        let processedItems = 0;

        // Function to update progress
        const updateProgress = (currentPath) => {
          processedItems++;
          const progress = Math.round((processedItems / totalItems) * 100);
          const progressBar =
            "█".repeat(progress / 2) + "░".repeat(50 - progress / 2);
          this.log(
            `[${progressBar}] ${progress}% - Processing: ${path.relative(
              sourcePath,
              currentPath
            )}`
          );
        };

        // Modified recursive copy function with progress
        const copyWithProgress = async (sourceDir, destDir) => {
          const entries = fs.readdirSync(sourceDir, { withFileTypes: true });

          for (const entry of entries) {
            const sourcePath = path.join(sourceDir, entry.name);
            const destPath = path.join(destDir, entry.name);

            if (entry.isDirectory()) {
              if (!fs.existsSync(destPath)) {
                fs.mkdirSync(destPath, { recursive: true });
              }
              await copyWithProgress(sourcePath, destPath);
            } else {
              const relativePath = path.relative(
                this.templatePath("terraform"),
                sourcePath
              );
              this._copyTemplateFile(
                `terraform/${relativePath}`,
                `terraform/${relativePath}`,
                {}
              );
            }
            updateProgress(sourcePath);
          }
        };

        this.log("\nCopying Terraform configuration...");
        await copyWithProgress(sourcePath, destPath);

        this.log("\n✓ All Terraform files copied successfully");

        // Force write to disk
        await new Promise((resolve, reject) => {
          this.fs.commit((err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      } catch (error) {
        this.log("Error setting up Terraform:", error.message);
        if (this.options.debug) {
          this.log("Stack trace:", error.stack);
        }
        // Don't throw the error, just log it and continue
      }
    }
  }

  async install() {
    try {
      // Setup project directory
      await this._setupProjectDirectory();

      // Setup README
      await this._readme();

      // Setup Terraform
      await this._setupTerraform();

      // Copy .gitignore from template
      this._copyTemplateFile("gitignore.tpl", ".gitignore", {});

      // Print summary
      this._printSummary(process.cwd(), this.answers.projectName);
    } catch (error) {
      this.log.error("Error during installation:", error);
      process.exit(1);
    }
  }

  _printSummary(installPath, projectName) {
    this.log("\n=== Installation Summary ===");
    this.log("\nProject Setup:");
    this.log(`✓ Created new devops project: ${projectName}`);
    this.log(`✓ Location: ${installPath}`);
  }

  _debugLog(message) {
    if (this.options.debug) {
      this.log(`[DEBUG] ${message}`);
    }
  }
};

import {
	App,
	Command,
	Component,
	Editor,
	MarkdownRenderer,
	MarkdownView,
	Modal,
	Plugin,
	PluginSettingTab,
	Setting,
} from "obsidian";

import OpenAI from "openai";

interface TextReplacerSettings {
	provider: "openai";
	api_key: string | undefined;
}

const DEFAULT_SETTINGS: TextReplacerSettings = {
	provider: "openai",
	api_key: undefined,
};

export default class TextReplacerPlugin extends Plugin {
	settings: TextReplacerSettings;
	async onload() {
		await this.loadSettings();
		// Add the command to open the modal
		const command: Command = {
			id: "open-text-replacer-modal",
			name: "Replace selection with AI input",
			icon: "brain-circuit",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				if (editor.somethingSelected()) {
					new TextReplacerModal(
						this.app,
						editor,
						this.settings
					).open();
				} else {
					// Notify user that text needs to be selected
					new Notice("Please select some text first");
				}
			},
		};
		this.addCommand(command);
		this.addMenuItem(command);

		this.addSettingTab(new TextReplacerSettingTab(this.app, this));
	}

	onunload() {
		console.log("Text Replacer plugin unloaded");
	}

	// add command to right-click menu
	// Shoutout to https://github.com/kzhovn/obsidian-customizable-menu
	addMenuItem(command: Command) {
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu) => {
				menu.addItem((item) => {
					item.setTitle(command.name)
						.setIcon(command.icon || null)
						.onClick(() => {
							//@ts-ignore
							this.app.commands.executeCommandById(command.id);
						});
				});
			})
		);
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class TextReplacerModal extends Modal {
	private editor: Editor;
	private settings: TextReplacerSettings;
	private inputEl: HTMLTextAreaElement;
	private resultEl: HTMLDivElement;
	private originalText: string;
	private lastGeneratedMarkdown: string;

	constructor(app: App, editor: Editor, settings: TextReplacerSettings) {
		super(app);
		this.editor = editor;
		this.settings = settings;
		this.originalText = editor.getSelection();
		this.lastGeneratedMarkdown = "";
	}

	onOpen() {
		const { contentEl } = this;

		// Create modal title
		contentEl.createEl("h2", { text: "AI Text Replacer" });

		if (!this.settings.api_key) {
			const warningContainer = contentEl.createEl("div", {
				cls: "no-api-key-warning",
			});

			// Create warning icon element
			const iconEl = warningContainer.createEl("span", {
				cls: "warning-icon",
			});
			iconEl.innerHTML = "⚠️"; // Warning emoji

			// Create warning text
			warningContainer.createEl("span", {
				text: "No API Key detected. Please set an API key in settings.",
				cls: "warning-text",
			});
		}

		// Create description
		contentEl.createEl("p", {
			text: "Enter your prompt below. The response will replace your selected text.",
		});

		// Create input textarea
		this.inputEl = contentEl.createEl("textarea", {
			attr: {
				placeholder: "Enter your prompt here...",
				rows: "4",
			},
		});
		this.inputEl.className = "text-replacer-input";

		// Create a container for the result
		contentEl.createEl("h3", { text: "Preview" });
		this.resultEl = contentEl.createEl("div", {
			cls: "text-replacer-result",
		});
		this.resultEl.innerHTML = "<em>Response will appear here...</em>";

		// Create button container for layout
		const buttonContainer = contentEl.createEl("div", {
			cls: "text-replacer-buttons",
		});

		// Generate button
		const generateButton = buttonContainer.createEl("button", {
			text: "Generate Response",
			cls: "mod-cta",
		});
		generateButton.addEventListener("click", () => {
			this.generateResponse();
		});

		// Apply button
		const applyButton = buttonContainer.createEl("button", {
			text: "Append",
			cls: "mod-cta",
		});
		applyButton.addEventListener("click", () => {
			this.applyResponse("append");
		});

		// Apply button
		const applyReplaceButton = buttonContainer.createEl("button", {
			text: "Replace",
			cls: "mod-cta",
		});
		applyReplaceButton.addEventListener("click", () => {
			this.applyResponse("replace");
		});

		// Cancel button
		const cancelButton = buttonContainer.createEl("button", {
			text: "Cancel",
		});
		cancelButton.addEventListener("click", () => {
			this.close();
		});

		// Add event listener for Enter key in input
		this.inputEl.addEventListener("keydown", async (event) => {
			if (event.key === "Enter" && !event.shiftKey) {
				event.preventDefault();
				this.generateResponse();
			}
		});

		// Focus the input element
		this.inputEl.focus();

		// Add custom styles to the modal
		this.addStyles();
	}

	// Add some basic styling to the modal
	private addStyles() {
		const styleEl = document.createElement("style");
		styleEl.innerHTML = `
			.text-replacer-input {
				width: 100%;
				margin-bottom: 15px;
				border-radius: 5px;
			}
			.text-replacer-result {
				min-height: 50px;
				margin-bottom: 15px;
				padding: 10px;
				border: 1px solid var(--background-modifier-border);
				border-radius: 5px;
				background-color: var(--background-secondary);
			}
			.text-replacer-buttons {
				display: flex;
				justify-content: flex-end;
				gap: 10px;
				margin-top: 10px;
			}
			.no-api-key-warning {
				display: flex;
				align-items: center;
				background-color: #ffebee;
				color: #c62828;
				padding: 10px;
				border-radius: 5px;
				border-left: 4px solid #c62828;
				margin-bottom: 15px;
				}
			.warning-icon {
			font-size: 18px;
			margin-right: 10px;
			}
			.warning-text {
			font-weight: 500;
			}
			.spinner-container {
				display: flex;
				flex-direction: column;
				align-items: center;
				justify-content: center;
				padding: 15px;
			}
			
			.spinner {
				width: 30px;
				height: 30px;
				border: 3px solid var(--background-modifier-border);
				border-top: 3px solid var(--interactive-accent);
				border-radius: 50%;
				animation: spin 1s linear infinite;
				margin-bottom: 10px;
			}
			
			.spinner-text {
				color: var(--text-muted);
				font-size: 14px;
			}
			
			@keyframes spin {
				0% { transform: rotate(0deg); }
				100% { transform: rotate(360deg); }
			}
			.markdown-rendered {
			padding: 0;
			max-height: 300px;
			overflow-y: auto;
			}
			
			.markdown-rendered p:first-child {
			margin-top: 0;
			}
			
			.markdown-rendered p:last-child {
			margin-bottom: 0;
			}
		`;
		document.head.appendChild(styleEl);
	}

	private showSpinner() {
		this.resultEl.innerHTML = `
		  <div class="spinner-container">
			<div class="spinner"></div>
			<div class="spinner-text">Generating response...</div>
		  </div>
		`;
	}

	private async displayRenderedMarkdown(markdownContent: string) {
		// Clear previous content
		this.resultEl.empty();

		// Create a wrapper div
		const markdownWrapper = this.resultEl.createDiv({
			cls: "markdown-rendered",
		});

		// Use MarkdownRenderer to render the content
		await MarkdownRenderer.renderMarkdown(
			markdownContent,
			markdownWrapper,
			".", // Source path - using '.' as a placeholder
			new Component() // Component - not needed for this usage
		);
	}

	// Generate a response based on the input
	private async generateResponse() {
		const question = this.inputEl.value.trim();
		this.showSpinner();

		if (!question) {
			this.resultEl.innerHTML = "<em>Please enter a question first.</em>";
			return;
		}

		try {
			// Process the question
			const response = await this.processQuestion(question);
			this.lastGeneratedMarkdown = response;

			// Render the markdown properly
			await this.displayRenderedMarkdown(response);
		} catch (error) {
			this.resultEl.innerHTML = `<em class="error">Error: ${
				error.message || "Failed to generate response"
			}</em>`;
		}
	}

	private async processQuestion(question: string): Promise<string> {
		const client = new OpenAI({
			apiKey: this.settings.api_key,
			dangerouslyAllowBrowser: true,
		});
		return client.chat.completions
			.create({
				messages: [
					{
						role: "user",
						content: `${question}: \n ${this.originalText}`,
					},
				],
				model: "gpt-4o",
			})
			.then((r) => r.choices[0].message.content || "Unknown")
			.catch((err) => "An error occured");
	}

	// Apply the response to the editor
	private applyResponse(mode: "replace" | "append") {
		if (
			this.resultEl.innerHTML ===
				"<em>Response will appear here...</em>" ||
			this.resultEl.innerHTML ===
				"<em>Please enter a question first.</em>"
		) {
			this.resultEl.innerHTML =
				"<em>Please generate a response first.</em>";
			return;
		}

		// Get the raw markdown from our internal storage rather than the HTML content
		let markdownContent = this.lastGeneratedMarkdown || "";

		if (markdownContent) {
			if (mode == "append") {
				markdownContent = `${this.originalText}\n ${markdownContent}`;
			}
			this.editor.replaceSelection(markdownContent);
			this.close();
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class Notice {
	constructor(message: string, timeout = 4000) {
		const notice = document.createElement("div");
		notice.className = "notice";
		notice.textContent = message;

		document.body.appendChild(notice);

		// Add styles for the notice
		const styleEl = document.createElement("style");
		styleEl.innerHTML = `
			.notice {
				position: fixed;
				top: 20px;
				right: 20px;
				background-color: var(--background-primary);
				color: var(--text-normal);
				padding: 10px 15px;
				border-radius: 5px;
				box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
				z-index: 1000;
				animation: fadeIn 0.3s, fadeOut 0.3s ${timeout - 300}ms;
				opacity: 0;
			}
			
			@keyframes fadeIn {
				from { opacity: 0; }
				to { opacity: 1; }
			}
			
			@keyframes fadeOut {
				from { opacity: 1; }
				to { opacity: 0; }
			}
		`;
		document.head.appendChild(styleEl);

		setTimeout(() => {
			notice.style.opacity = "1";
		}, 0);

		setTimeout(() => {
			notice.remove();
			styleEl.remove();
		}, timeout);
	}
}

class TextReplacerSettingTab extends PluginSettingTab {
	plugin: TextReplacerPlugin;

	constructor(app: App, plugin: TextReplacerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		// Add provider-specific help information

		containerEl.empty();

		containerEl.createEl("h2", { text: "AI Writing Assistant Settings" });

		containerEl.createEl("p", {
			text: "Configure your AI provider and API key to enable the AI writing features.",
		});

		// AI Provider Setting
		new Setting(containerEl)
			.setName("AI Provider")
			.setDesc("Select which AI provider to use for generating responses")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("openai", "OpenAI (GPT)")
					.setValue(this.plugin.settings.provider)
					.onChange(async (value: "openai") => {
						this.plugin.settings.provider = value;
						await this.plugin.saveSettings();
					})
			);

		// API Key Setting
		new Setting(containerEl)
			.setName("API Key")
			.setDesc("Enter your API key for the selected provider")
			.addText((text) =>
				text
					.setPlaceholder("Enter API key...")
					.setValue(this.plugin.settings.api_key || "")
					.onChange(async (value) => {
						// Only save if value isn't empty
						this.plugin.settings.api_key = value
							? value
							: undefined;
						await this.plugin.saveSettings();
					})
			)
			.addExtraButton((button) => {
				button
					.setIcon("eye-off")
					.setTooltip("Show/Hide API Key")
					.onClick(() => {
						const textInput =
							button.extraSettingsEl.querySelector("input");
						if (textInput) {
							if (textInput.type === "password") {
								textInput.type = "text";
								button.setIcon("eye");
							} else {
								textInput.type = "password";
								button.setIcon("eye-off");
							}
						}
					});

				// Set the input type to password by default for security
				setTimeout(() => {
					const textInput =
						button.extraSettingsEl.querySelector("input");
					if (textInput) {
						textInput.type = "password";
					}
				}, 0);
			});

		// Help Text
		containerEl.createEl("div", {
			cls: "setting-item-description",
			text: "Your API key is stored in your Obsidian configuration and never shared. Make sure to keep your API key secure.",
		});

		const providerInfoEl = containerEl.createEl("div", {
			cls: "setting-item",
		});

		// Update provider info when dropdown changes
		this.updateProviderInfo(providerInfoEl);

		// Observe changes to the provider setting to update the info
		const observer = new MutationObserver(() => {
			this.updateProviderInfo(providerInfoEl);
		});

		observer.observe(containerEl, {
			childList: true,
			subtree: true,
			attributes: true,
		});
	}

	updateProviderInfo(containerEl: HTMLElement) {
		containerEl.empty();

		const contentEl = containerEl.createEl("div", {
			cls: "setting-item-description",
		});

		if (this.plugin.settings.provider === "openai") {
			contentEl.innerHTML = `
				<p>To use OpenAI's services, you need an API key.</p>
				<ol>
					<li>Go to <a href="https://platform.openai.com/account/api-keys">OpenAI API Keys</a></li>
					<li>Sign in or create an account</li>
					<li>Create a new API key</li>
					<li>Copy and paste it above</li>
				</ol>
				<p>OpenAI's API is a paid service. You will be charged based on your usage.</p>
			`;
		} else {
			contentEl.innerHTML = `
				<p>To use Claude, you need an Anthropic API key.</p>
				<ol>
					<li>Go to <a href="https://console.anthropic.com/account/keys">Anthropic Console</a></li>
					<li>Sign in or create an account</li>
					<li>Create a new API key</li>
					<li>Copy and paste it above</li>
				</ol>
				<p>Anthropic's API is a paid service. You will be charged based on your usage.</p>
			`;
		}
	}
}

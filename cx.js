#!/usr/bin/env node

import fs from 'fs';
import axios from 'axios';
import * as cheerio from 'cheerio';
import AdmZip from 'adm-zip';
import {fileURLToPath} from 'url';
import path from 'path';
import minimist from 'minimist';
import {checkbox, input} from '@inquirer/prompts';
import yaml from 'yaml';
import chalk from 'chalk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- CLI args (robustos) ---
const args = minimist(process.argv.slice(2), {
	boolean: ['all', 'no-zip', 'noZip', 'debug'],
	alias: {
		m: 'mode',
		n: 'name',
		all: 'a',
		// permitir ambas variantes:
		noZip: 'no-zip',
	},
	default: {
		'all': false,
		'no-zip': false,
		'noZip': false,
		'debug': false,
	},
});

const url = args._[0];
const mode = args.mode;
const sharedName = args.name;
const includeAll = !!args.all;
const noZip = !!(args['no-zip'] || args.noZip); // <- acepta ambas

if (args.debug) {
	console.log(chalk.cyan('[DEBUG] raw argv:'), process.argv.slice(2));
	console.log(chalk.cyan('[DEBUG] parsed args:'), args);
}

if (!url) {
	console.error(
		`${chalk.red(
			'❌'
		)} Usage: node cx.js https://example.com [--mode=css|js] [--all] [--name "Name"] [--no-zip] [--debug]`
	);
	process.exit(1);
}

// --- Paths ---
const OUTPUT_DIR = path.join(__dirname, 'output');
const TEMP_DIR = path.join(OUTPUT_DIR, 'temp');
const ASSETS_DIR = path.join(TEMP_DIR, 'assets');

// --- Config por modo ---
const MODES = {
	css: {
		fileName: 'global.css',
		yamlType: 'globalCSS',
	},
	js: {
		fileName: 'global.js',
		yamlType: 'globalJS',
		scriptElementAttributes: {
			'async': true,
			'data-attribute': 'value',
			'data-senna-track': 'permanent',
			'fetchpriority': 'low',
		},
	},
};

// --- Helpers ---
function slugify(name, suffix) {
	return (
		name
			.toLowerCase()
			.replace(/\s+/g, '-')
			.replace(/[^a-z0-9\-]/g, '') + `-${suffix}`
	);
}

async function fetchPage(targetUrl) {
	try {
		const res = await axios.get(targetUrl);
		return res.data;
	} catch (e) {
		throw new Error(`Failed to fetch page: ${e.message}`);
	}
}

function parseResources(html, baseUrl, currentMode) {
	const $ = cheerio.load(html);
	const found = [];
	let inlineCounter = 1;

	if (currentMode === 'css') {
		$('link[rel="stylesheet"], style').each((_, el) => {
			if (el.tagName === 'link') {
				const href = $(el).attr('href');
				if (href) {
					const full = new URL(href, baseUrl).href;
					found.push({type: 'external', label: full, url: full});
				}
			} else {
				found.push({
					type: 'inline',
					label: `<style> inline #${inlineCounter++}`,
					content: $(el).html(),
				});
			}
		});
	} else {
		$('script').each((_, el) => {
			const src = $(el).attr('src');
			if (src) {
				const full = new URL(src, baseUrl).href;
				found.push({type: 'external', label: full, url: full});
			} else {
				const content = $(el).html();
				if (content?.trim()) {
					found.push({
						type: 'inline',
						label: `<script> inline #${inlineCounter++}`,
						content,
					});
				}
			}
		});
	}

	return found;
}

async function promptSelection(resources, currentMode, includeAllFlag) {
	if (includeAllFlag) {
		console.log(
			`${chalk.green(
				'✅'
			)} --all flag: all ${currentMode.toUpperCase()} resources included.\n`
		);
		return resources;
	}

	const choices = await checkbox({
		message: `Select which ${currentMode.toUpperCase()} resources to include:`,
		choices: resources.map((item, i) => ({
			name: item.label,
			value: i.toString(),
			checked: true,
		})),
	});

	if (choices.length === 0) {
		console.log(
			`${chalk.yellow(
				'⚠️'
			)} No ${currentMode.toUpperCase()} selected. Skipping.`
		);
		return [];
	}

	return choices.map((i) => resources[parseInt(i, 10)]);
}

async function downloadResources(resources) {
	const results = await Promise.all(
		resources.map(async (res) => {
			if (res.type === 'external') {
				try {
					const r = await axios.get(res.url);
					console.log(
						`${chalk.green('✅')} Loaded external: ${res.url}`
					);
					return `/* ${res.url} */\n${r.data}`;
				} catch (e) {
					console.warn(
						`${chalk.yellow('⚠️')} Failed to load ${res.url}: ${
							e.message
						}`
					);
					return '';
				}
			} else {
				console.log(`${chalk.green('✅')} Loaded ${res.label}`);
				return `/* ${res.label} */\n${res.content}`;
			}
		})
	);

	return results.join('\n\n');
}

function generateYaml(technicalName, visibleName, currentMode, fileName) {
	const base = {
		assemble: [{from: 'assets', into: 'static'}],
		[technicalName]: {
			name: visibleName,
			type: MODES[currentMode].yamlType,
			url: fileName,
		},
	};

	if (currentMode === 'js') {
		base[technicalName].scriptElementAttributes =
			MODES.js.scriptElementAttributes;
	}

	return yaml.stringify(base);
}

function saveFiles(fileName, content, yamlContent, technicalName, noZipFlag) {
	fs.mkdirSync(ASSETS_DIR, {recursive: true});
	const filePath = path.join(ASSETS_DIR, fileName);
	const yamlPath = path.join(TEMP_DIR, 'client-extension.yaml');

	fs.writeFileSync(filePath, content, 'utf8');
	fs.writeFileSync(yamlPath, yamlContent, 'utf8');

	const zipPath = path.join(OUTPUT_DIR, `${technicalName}.zip`);

	if (!noZipFlag) {
		const zip = new AdmZip();
		zip.addLocalFile(filePath, 'assets');
		zip.addLocalFile(yamlPath);
		zip.writeZip(zipPath);
		console.log(`${chalk.green('🎉')} Final ZIP created at: ${zipPath}`);

		// Limpiar temp SOLO si hemos zipeado
		fs.rmSync(TEMP_DIR, {recursive: true, force: true});
	} else {
		console.log(
			`${chalk.green('📂')} Files saved without ZIP in: ${TEMP_DIR}`
		);
		console.log(
			`${chalk.yellow(
				'ℹ️'
			)} Note: running both modes without --mode will overwrite temp/ on the second run.`
		);
	}
}

// --- Main extraction ---
async function runOnce(targetUrl, currentMode, sharedVisibleName) {
	console.log(
		`${chalk.blue(
			'🌐'
		)} Fetching ${targetUrl} for ${currentMode.toUpperCase()}...`
	);

	const html = await fetchPage(targetUrl);
	const found = parseResources(html, targetUrl, currentMode);

	if (found.length === 0) {
		console.log(
			`${chalk.red(
				'❌'
			)} No ${currentMode.toUpperCase()} resources found.`
		);
		return;
	}

	const selected = await promptSelection(found, currentMode, includeAll);
	if (selected.length === 0) return;

	let visibleName = sharedVisibleName;
	if (!visibleName) {
		visibleName = await input({
			message: `Visible name of the Client Extension (${currentMode.toUpperCase()}):`,
			default:
				currentMode === 'css'
					? 'Liferay CSS Client Extension'
					: 'Liferay JS Client Extension',
			validate: (val) => {
				if (!/^[a-zA-Z0-9\s\-]+$/.test(val)) {
					return 'Only letters, numbers, spaces and dashes are allowed.';
				}
				return true;
			},
		});
	}

	const technicalName = slugify(visibleName, currentMode);
	const fileName = MODES[currentMode].fileName;

	console.log(
		`${chalk.blue('📄')} Selected ${currentMode.toUpperCase()} blocks: ${
			selected.length
		}`
	);

	const combined = await downloadResources(selected);
	const yamlContent = generateYaml(
		technicalName,
		visibleName,
		currentMode,
		fileName
	);

	saveFiles(fileName, combined, yamlContent, technicalName, noZip);
}

// --- CLI entry point ---
(async () => {
	if (!mode) {
		await runOnce(url, 'css', sharedName);
		await runOnce(url, 'js', sharedName);
	} else if (mode === 'css' || mode === 'js') {
		await runOnce(url, mode, sharedName);
	} else {
		console.error(
			`${chalk.red('❌')} Invalid mode. Use --mode=css or --mode=js`
		);
		process.exit(1);
	}
})();

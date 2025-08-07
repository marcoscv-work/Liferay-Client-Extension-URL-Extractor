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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// CLI args
const args = minimist(process.argv.slice(2));
const url = args._[0];
const mode = args.mode;
const sharedName = args.name;

if (!url) {
	console.error(
		'❌ Usage: node cx.js https://example.com [--mode=css|js] [--all] [--name "Name"]'
	);
	process.exit(1);
}

// Paths
const OUTPUT_DIR = path.join(__dirname, 'output');
const TEMP_DIR = path.join(OUTPUT_DIR, 'temp');
const ASSETS_DIR = path.join(TEMP_DIR, 'assets');

async function extractResources(url, mode, sharedName) {
	console.log(`🌐 Fetching ${url} for ${mode.toUpperCase()}...`);
	let res;
	try {
		res = await axios.get(url);
	} catch (e) {
		console.error('❌ Failed to fetch page:', e.message);
		process.exit(1);
	}

	const $ = cheerio.load(res.data);
	const found = [];

	let inlineCounter = 1;
	if (mode === 'css') {
		$('link[rel="stylesheet"], style').each((_, el) => {
			if (el.tagName === 'link') {
				const href = $(el).attr('href');
				if (href) {
					const cssUrl = new URL(href, url).href;
					found.push({type: 'external', label: cssUrl, url: cssUrl});
				}
			} else if (el.tagName === 'style') {
				const content = $(el).html();
				found.push({
					type: 'inline',
					label: `<style> inline #${inlineCounter++}`,
					content,
				});
			}
		});
	} else {
		$('script').each((_, el) => {
			const src = $(el).attr('src');
			if (src) {
				const jsUrl = new URL(src, url).href;
				found.push({type: 'external', label: jsUrl, url: jsUrl});
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

	if (found.length === 0) {
		console.log(`❌ No ${mode.toUpperCase()} resources found.`);
		return;
	}

	let selected;
	if (args.all) {
		selected = found;
		console.log(
			`✅ --all flag: all ${mode.toUpperCase()} resources included.\n`
		);
	} else {
		const choices = await checkbox({
			message: `Select which ${mode.toUpperCase()} resources to include:`,
			choices: found.map((item, i) => ({
				name: item.label,
				value: i.toString(),
				checked: true,
			})),
		});
		if (choices.length === 0) {
			console.log(`⚠️ No ${mode.toUpperCase()} selected. Skipping.`);
			return;
		}
		selected = choices.map((i) => found[parseInt(i)]);
	}

	let nameInput = sharedName;

	if (!nameInput) {
		nameInput = await input({
			message: `Visible name of the Client Extension (${mode.toUpperCase()}):`,
			default:
				mode === 'css'
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

	const technicalName =
		nameInput
			.toLowerCase()
			.replace(/\s+/g, '-')
			.replace(/[^a-z0-9\-]/g, '') + `-${mode}`;

	const filename = mode === 'css' ? 'global.css' : 'global.js';
	const FILE_PATH = path.join(ASSETS_DIR, filename);
	const zipFilename = `${technicalName}.zip`;
	const ZIP_PATH = path.join(OUTPUT_DIR, zipFilename);
	const YAML_PATH = path.join(TEMP_DIR, 'client-extension.yaml');

	console.log(`📄 Selected ${mode.toUpperCase()} blocks: ${selected.length}`);
	let combined = '';

	for (const res of selected) {
		if (res.type === 'external') {
			try {
				const r = await axios.get(res.url);
				combined += `/* ${res.url} */\n${r.data}\n\n`;
				console.log(`✅ Loaded external: ${res.url}`);
			} catch (e) {
				console.warn(`⚠️ Failed to load ${res.url}: ${e.message}`);
			}
		} else if (res.type === 'inline') {
			combined += `/* ${res.label} */\n${res.content}\n\n`;
			console.log(`✅ Loaded ${res.label}`);
		}
	}

	// Write files
	fs.mkdirSync(ASSETS_DIR, {recursive: true});
	fs.writeFileSync(FILE_PATH, combined, 'utf8');

	// YAML content
	const clientExt = {
		assemble: [{from: 'assets', into: 'static'}],
		[technicalName]: {
			name: nameInput,
			type: mode === 'css' ? 'globalCSS' : 'globalJS',
			url: filename,
			...(mode === 'js' && {
				scriptElementAttributes: {
					'async': true,
					'data-attribute': 'value',
					'data-senna-track': 'permanent',
					'fetchpriority': 'low',
				},
			}),
		},
	};

	fs.writeFileSync(YAML_PATH, yaml.stringify(clientExt), 'utf8');

	// Create ZIP
	const zip = new AdmZip();
	zip.addLocalFile(FILE_PATH, 'assets');
	zip.addLocalFile(YAML_PATH);
	zip.writeZip(ZIP_PATH);

	console.log(`✅ ${filename} saved in: ${FILE_PATH}`);
	console.log(`✅ client-extension.yaml created`);
	console.log(`🎉 Final ZIP created at: ${ZIP_PATH}\n`);

	// Cleanup temp directory
	fs.rmSync(TEMP_DIR, {recursive: true, force: true});
}

(async () => {
	if (!mode) {
		await extractResources(url, 'css', sharedName);
		await extractResources(url, 'js', sharedName);
	} else if (mode === 'css' || mode === 'js') {
		await extractResources(url, mode, sharedName);
	} else {
		console.error('❌ Invalid mode. Use --mode=css or --mode=js');
		process.exit(1);
	}
})();

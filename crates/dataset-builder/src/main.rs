extern crate alloc;

#[allow(dead_code, unused_imports)]
mod compact_ac;

use crate::compact_ac::{CharwiseDoubleArrayAhoCorasickBuilder, DoubleArrayAhoCorasickBuilder};
use std::collections::{HashMap, HashSet};
use std::env;
use std::error::Error;
use std::fmt;
use std::fs::{self, File};
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

const DEFAULT_USER_AGENT: &str =
    "obsidian-wikipage-spine-dataset-builder/0.1 (+https://github.com/moskize91/obsidian-wikipage-spine)";
const WIKIMEDIA_DUMPS_BASE: &str = "https://dumps.wikimedia.org";

type Result<T> = std::result::Result<T, Box<dyn Error>>;

#[derive(Debug)]
struct CliError(String);

impl fmt::Display for CliError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl Error for CliError {}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Component {
    Page,
    Redirect,
    PageProps,
    WikidataEntities,
}

impl Component {
    fn parse(value: &str) -> Result<Self> {
        match value {
            "page" => Ok(Self::Page),
            "redirect" => Ok(Self::Redirect),
            "page_props" | "page-props" => Ok(Self::PageProps),
            "wikidata_entities" | "wikidata-entities" => Ok(Self::WikidataEntities),
            _ => Err(CliError(format!("unknown component: {value}")).into()),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Page => "page",
            Self::Redirect => "redirect",
            Self::PageProps => "page_props",
            Self::WikidataEntities => "wikidata_entities",
        }
    }
}

#[derive(Debug)]
struct DownloadArgs {
    out: PathBuf,
    wikis: Vec<String>,
    components: Vec<Component>,
    date: String,
    dry_run: bool,
    force: bool,
    user_agent: String,
}

impl Default for DownloadArgs {
    fn default() -> Self {
        Self {
            out: PathBuf::from("crates/data/dumps"),
            wikis: vec!["zhwiki".to_string(), "enwiki".to_string()],
            components: vec![Component::Page, Component::Redirect, Component::PageProps],
            date: "latest".to_string(),
            dry_run: false,
            force: false,
            user_agent: DEFAULT_USER_AGENT.to_string(),
        }
    }
}

#[derive(Debug)]
struct DownloadTarget {
    component: Component,
    wiki: Option<String>,
    url: String,
    path: PathBuf,
}

fn main() -> Result<()> {
    let mut args = env::args().skip(1);
    let Some(command) = args.next() else {
        print_help();
        return Ok(());
    };

    match command.as_str() {
        "download" => download(parse_download_args(args.collect())?),
        "process" | "preprocess" => preprocess(parse_process_args(args.collect())?),
        "compile" => compile(parse_compile_args(args.collect())?),
        "-h" | "--help" | "help" => {
            print_help();
            Ok(())
        }
        _ => Err(CliError(format!("unknown command: {command}")).into()),
    }
}

#[derive(Debug)]
struct ProcessArgs {
    dumps: PathBuf,
    out: PathBuf,
    wikis: Vec<String>,
    date: String,
    limit: Option<usize>,
}

impl Default for ProcessArgs {
    fn default() -> Self {
        Self {
            dumps: PathBuf::from("crates/data/dumps"),
            out: PathBuf::from("crates/data/preprocess"),
            wikis: vec!["zhwiki".to_string(), "enwiki".to_string()],
            date: "latest".to_string(),
            limit: None,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum CompileMode {
    Charwise,
    Bytewise,
}

impl CompileMode {
    fn parse(value: &str) -> Result<Self> {
        match value {
            "charwise" | "char" => Ok(Self::Charwise),
            "bytewise" | "byte" => Ok(Self::Bytewise),
            _ => Err(CliError(format!("unknown compile mode: {value}")).into()),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Charwise => "charwise",
            Self::Bytewise => "bytewise",
        }
    }
}

#[derive(Debug)]
struct CompileArgs {
    preprocess: PathBuf,
    out: PathBuf,
    mode: CompileMode,
    limit: Option<usize>,
    progress_every: usize,
}

impl Default for CompileArgs {
    fn default() -> Self {
        Self {
            preprocess: PathBuf::from("crates/data/preprocess"),
            out: PathBuf::from("crates/data/compile"),
            mode: CompileMode::Charwise,
            limit: None,
            progress_every: 100_000,
        }
    }
}

#[derive(Debug)]
struct Page {
    title: String,
    qid: Option<String>,
}

#[derive(Debug)]
struct SurfaceRow {
    wiki: String,
    surface_key: String,
    surface_text: String,
    qid: String,
    source: &'static str,
    page_id: u64,
    target_page_id: u64,
}

fn parse_download_args(raw_args: Vec<String>) -> Result<DownloadArgs> {
    let mut args = DownloadArgs::default();
    let mut index = 0;

    while index < raw_args.len() {
        match raw_args[index].as_str() {
            "--out" => {
                index += 1;
                args.out = PathBuf::from(require_value(&raw_args, index, "--out")?);
            }
            "--wikis" => {
                index += 1;
                args.wikis = split_csv(require_value(&raw_args, index, "--wikis")?);
            }
            "--components" => {
                index += 1;
                args.components = split_csv(require_value(&raw_args, index, "--components")?)
                    .into_iter()
                    .map(|value| Component::parse(&value))
                    .collect::<Result<Vec<_>>>()?;
            }
            "--date" => {
                index += 1;
                args.date = require_value(&raw_args, index, "--date")?.to_string();
            }
            "--user-agent" => {
                index += 1;
                args.user_agent = require_value(&raw_args, index, "--user-agent")?.to_string();
            }
            "--dry-run" => args.dry_run = true,
            "--force" => args.force = true,
            "-h" | "--help" => {
                print_download_help();
                std::process::exit(0);
            }
            unknown => return Err(CliError(format!("unknown download option: {unknown}")).into()),
        }
        index += 1;
    }

    if args.wikis.is_empty() {
        return Err(CliError("at least one wiki must be selected".to_string()).into());
    }
    if args.components.is_empty() {
        return Err(CliError("at least one component must be selected".to_string()).into());
    }
    validate_date(&args.date)?;

    Ok(args)
}

fn parse_process_args(raw_args: Vec<String>) -> Result<ProcessArgs> {
    let mut args = ProcessArgs::default();
    let mut index = 0;

    while index < raw_args.len() {
        match raw_args[index].as_str() {
            "--dumps" => {
                index += 1;
                args.dumps = PathBuf::from(require_value(&raw_args, index, "--dumps")?);
            }
            "--out" => {
                index += 1;
                args.out = PathBuf::from(require_value(&raw_args, index, "--out")?);
            }
            "--wikis" => {
                index += 1;
                args.wikis = split_csv(require_value(&raw_args, index, "--wikis")?);
            }
            "--date" => {
                index += 1;
                args.date = require_value(&raw_args, index, "--date")?.to_string();
            }
            "--limit" => {
                index += 1;
                let value = require_value(&raw_args, index, "--limit")?;
                args.limit = Some(value.parse::<usize>().map_err(|err| {
                    CliError(format!("--limit must be a positive integer: {err}"))
                })?);
            }
            "-h" | "--help" => {
                print_process_help();
                std::process::exit(0);
            }
            unknown => return Err(CliError(format!("unknown process option: {unknown}")).into()),
        }
        index += 1;
    }

    if args.wikis.is_empty() {
        return Err(CliError("at least one wiki must be selected".to_string()).into());
    }
    validate_date(&args.date)?;

    Ok(args)
}

fn parse_compile_args(raw_args: Vec<String>) -> Result<CompileArgs> {
    let mut args = CompileArgs::default();
    let mut index = 0;

    while index < raw_args.len() {
        match raw_args[index].as_str() {
            "--preprocess" => {
                index += 1;
                args.preprocess = PathBuf::from(require_value(&raw_args, index, "--preprocess")?);
            }
            "--out" => {
                index += 1;
                args.out = PathBuf::from(require_value(&raw_args, index, "--out")?);
            }
            "--mode" => {
                index += 1;
                args.mode = CompileMode::parse(require_value(&raw_args, index, "--mode")?)?;
            }
            "--limit" => {
                index += 1;
                let value = require_value(&raw_args, index, "--limit")?;
                args.limit = Some(value.parse::<usize>().map_err(|err| {
                    CliError(format!("--limit must be a positive integer: {err}"))
                })?);
            }
            "--progress-every" => {
                index += 1;
                let value = require_value(&raw_args, index, "--progress-every")?;
                args.progress_every = value.parse::<usize>().map_err(|err| {
                    CliError(format!(
                        "--progress-every must be a positive integer: {err}"
                    ))
                })?;
            }
            "-h" | "--help" => {
                print_compile_help();
                std::process::exit(0);
            }
            unknown => return Err(CliError(format!("unknown compile option: {unknown}")).into()),
        }
        index += 1;
    }

    if args.progress_every == 0 {
        return Err(CliError("--progress-every must be greater than zero".to_string()).into());
    }

    Ok(args)
}

fn require_value<'a>(args: &'a [String], index: usize, option: &str) -> Result<&'a str> {
    args.get(index)
        .map(String::as_str)
        .filter(|value| !value.starts_with("--"))
        .ok_or_else(|| CliError(format!("{option} requires a value")).into())
}

fn split_csv(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .map(str::to_string)
        .collect()
}

fn download(args: DownloadArgs) -> Result<()> {
    let targets = build_targets(&args)?;
    if targets.is_empty() {
        return Err(CliError("no download targets selected".to_string()).into());
    }

    if args.dry_run {
        for target in &targets {
            println!("{} -> {}", target.url, target.path.display());
        }
        return Ok(());
    }

    require_curl()?;
    fs::create_dir_all(&args.out)?;
    clean_download_target_dirs(&targets)?;

    for target in &targets {
        download_target(target, &args.user_agent, args.force)?;
    }

    write_manifest(&args.out.join("manifest.json"), &args.date, &targets)?;
    eprintln!("wrote {}", args.out.join("manifest.json").display());

    Ok(())
}

fn clean_download_target_dirs(targets: &[DownloadTarget]) -> Result<()> {
    let mut cleaned = HashSet::<PathBuf>::new();
    for target in targets {
        let Some(parent) = target.path.parent() else {
            continue;
        };
        let parent = parent.to_path_buf();
        if cleaned.insert(parent.clone()) && parent.exists() {
            fs::remove_dir_all(parent)?;
        }
    }
    Ok(())
}

fn preprocess(args: ProcessArgs) -> Result<()> {
    require_gzip()?;
    let out_dir = args.out.clone();
    if out_dir.exists() {
        fs::remove_dir_all(&out_dir)?;
    }
    fs::create_dir_all(&out_dir)?;

    let mut all_surfaces = Vec::new();
    let mut summaries = Vec::new();

    for wiki in &args.wikis {
        let page_path = dump_path(&args.dumps, wiki, &args.date, "page");
        let page_props_path = dump_path(&args.dumps, wiki, &args.date, "page_props");
        let redirect_path = dump_path(&args.dumps, wiki, &args.date, "redirect");

        eprintln!("processing {wiki} page table");
        let mut pages = read_pages(&page_path, args.limit)?;

        eprintln!("processing {wiki} page_props table");
        let qid_count = attach_page_qids(&page_props_path, &mut pages, args.limit)?;

        eprintln!("processing {wiki} redirect table");
        let redirects = read_redirects(wiki, &redirect_path, &pages, args.limit)?;

        let surfaces = build_surface_rows(wiki, &pages, &redirects);
        summaries.push(format!(
            "{wiki}\tpages_ns0={}\tpages_with_qid={qid_count}\tredirects_with_qid={}\tsurface_sources={}",
            pages.len(),
            redirects.len(),
            surfaces.len()
        ));

        all_surfaces.extend(surfaces);
    }

    let surface_qids = build_surface_qid_lists(&all_surfaces);
    summaries.push(format!(
        "global\tsurface_sources={}\tsurface_keys={}\tambiguous_surface_keys={}",
        all_surfaces.len(),
        surface_qids.len(),
        count_ambiguous_surfaces(&surface_qids)
    ));

    write_surface_sources_tsv(&out_dir.join("surface_sources.tsv"), &all_surfaces)?;
    write_surface_qid_lists_tsv(&out_dir.join("surface_qids.tsv"), &surface_qids)?;
    write_preprocess_manifest(&out_dir.join("manifest.json"), &args, &summaries)?;

    for summary in summaries {
        println!("{summary}");
    }

    Ok(())
}

fn compile(args: CompileArgs) -> Result<()> {
    let input_path = args.preprocess.join("surface_qids.tsv");
    if !input_path.exists() {
        return Err(CliError(format!("missing preprocess file: {}", input_path.display())).into());
    }

    let tmp_dir = compile_tmp_dir(&args.out);
    if tmp_dir.exists() {
        fs::remove_dir_all(&tmp_dir)?;
    }
    if args.out.exists() {
        fs::remove_dir_all(&args.out)?;
    }
    fs::create_dir_all(&tmp_dir)?;

    let progress_path = tmp_dir.join("progress.tsv");
    write_compile_progress(&progress_path, "ingest_started", 0, 0)?;

    let mut patterns = Vec::<String>::new();
    let mut pattern_bytes = 0usize;
    let input = File::open(&input_path)?;
    let reader = BufReader::new(input);

    for (line_number, line) in reader.lines().enumerate() {
        let line = line?;
        if line_number == 0 {
            validate_surface_qids_header(&line)?;
            continue;
        }
        if let Some(limit) = args.limit {
            if patterns.len() >= limit {
                break;
            }
        }
        let Some(surface_key) = first_tsv_column(&line) else {
            return Err(CliError(format!(
                "invalid surface_qids row without tab at line {}",
                line_number + 1
            ))
            .into());
        };
        let surface_key = unescape_tsv(surface_key);
        if surface_key.is_empty() {
            return Err(CliError(format!(
                "empty surface_key at surface_qids.tsv line {}",
                line_number + 1
            ))
            .into());
        }

        pattern_bytes += surface_key.len();
        patterns.push(surface_key);

        if patterns.len() % args.progress_every == 0 {
            eprintln!(
                "ingested surface_id={} surfaces={} pattern_bytes={}",
                patterns.len() - 1,
                patterns.len(),
                pattern_bytes
            );
            write_compile_progress(&progress_path, "ingesting", patterns.len(), pattern_bytes)?;
        }
    }

    if patterns.is_empty() {
        return Err(CliError("no surface keys found for compile".to_string()).into());
    }

    eprintln!(
        "building {} automaton surfaces={} pattern_bytes={}",
        args.mode.as_str(),
        patterns.len(),
        pattern_bytes
    );
    let surface_count = patterns.len();
    write_compile_progress(
        &progress_path,
        "build_started",
        surface_count,
        pattern_bytes,
    )?;

    let automaton_bytes = build_automaton_bytes(patterns, args.mode)?;
    let automaton_path = tmp_dir.join("automaton.bin");
    let mut automaton_file = BufWriter::new(File::create(&automaton_path)?);
    automaton_file.write_all(&automaton_bytes)?;
    automaton_file.flush()?;

    let automaton_size = automaton_path.metadata()?.len();
    write_compile_manifest(
        &tmp_dir.join("manifest.json"),
        &args,
        &input_path,
        surface_count,
        pattern_bytes,
        automaton_size,
    )?;
    write_compile_progress(&progress_path, "done", surface_count, pattern_bytes)?;

    fs::rename(&tmp_dir, &args.out)?;
    eprintln!(
        "wrote {} ({} bytes)",
        args.out.join("automaton.bin").display(),
        automaton_size
    );

    Ok(())
}

fn build_automaton_bytes(patterns: Vec<String>, mode: CompileMode) -> Result<Vec<u8>> {
    match mode {
        CompileMode::Charwise => {
            let entries = patterns
                .into_iter()
                .enumerate()
                .map(|(surface_id, pattern)| (pattern, checked_surface_id(surface_id)));
            let automaton = CharwiseDoubleArrayAhoCorasickBuilder::new()
                .build_with_values(entries)
                .map_err(|err| CliError(format!("failed to build charwise automaton: {err}")))?;
            Ok(automaton.serialize())
        }
        CompileMode::Bytewise => {
            let entries = patterns
                .into_iter()
                .enumerate()
                .map(|(surface_id, pattern)| {
                    (pattern.into_bytes(), checked_surface_id(surface_id))
                });
            let automaton = DoubleArrayAhoCorasickBuilder::new()
                .build_with_values(entries)
                .map_err(|err| CliError(format!("failed to build bytewise automaton: {err}")))?;
            Ok(automaton.serialize())
        }
    }
}

fn checked_surface_id(surface_id: usize) -> u32 {
    u32::try_from(surface_id).expect("surface_id overflowed u32")
}

fn compile_tmp_dir(out: &Path) -> PathBuf {
    let file_name = out
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("compile");
    out.with_file_name(format!("{file_name}.tmp"))
}

fn validate_surface_qids_header(line: &str) -> Result<()> {
    if line == "surface_key\tqids\tqid_count" {
        Ok(())
    } else {
        Err(CliError(format!("unexpected surface_qids.tsv header: {line}")).into())
    }
}

fn first_tsv_column(line: &str) -> Option<&str> {
    line.split_once('\t').map(|(first, _rest)| first)
}

fn unescape_tsv(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut chars = value.chars();
    while let Some(ch) = chars.next() {
        if ch != '\\' {
            output.push(ch);
            continue;
        }
        match chars.next() {
            Some('\\') => output.push('\\'),
            Some('t') => output.push('\t'),
            Some('n') => output.push('\n'),
            Some('r') => output.push('\r'),
            Some(other) => {
                output.push('\\');
                output.push(other);
            }
            None => output.push('\\'),
        }
    }
    output
}

fn write_compile_progress(
    path: &Path,
    phase: &str,
    surface_count: usize,
    pattern_bytes: usize,
) -> Result<()> {
    let mut file = File::create(path)?;
    writeln!(file, "phase\tsurface_count\tlast_surface_id\tpattern_bytes")?;
    let last_surface_id = surface_count
        .checked_sub(1)
        .map(|value| value.to_string())
        .unwrap_or_else(|| "-1".to_string());
    writeln!(
        file,
        "{}\t{}\t{}\t{}",
        phase, surface_count, last_surface_id, pattern_bytes
    )?;
    file.flush()?;
    Ok(())
}

fn write_compile_manifest(
    path: &Path,
    args: &CompileArgs,
    input_path: &Path,
    surface_count: usize,
    pattern_bytes: usize,
    automaton_size: u64,
) -> Result<()> {
    let mut file = File::create(path)?;
    writeln!(file, "{{")?;
    writeln!(file, "  \"generated_at_unix\": {},", generated_at_unix())?;
    writeln!(file, "  \"mode\": \"{}\",", args.mode.as_str())?;
    writeln!(
        file,
        "  \"preprocess\": \"{}\",",
        escape_json(&path_for_manifest(&args.preprocess))
    )?;
    writeln!(
        file,
        "  \"input\": \"{}\",",
        escape_json(&path_for_manifest(input_path))
    )?;
    writeln!(
        file,
        "  \"out\": \"{}\",",
        escape_json(&path_for_manifest(&args.out))
    )?;
    match args.limit {
        Some(limit) => writeln!(file, "  \"limit\": {limit},")?,
        None => writeln!(file, "  \"limit\": null,")?,
    }
    writeln!(file, "  \"surface_count\": {surface_count},")?;
    writeln!(file, "  \"pattern_bytes\": {pattern_bytes},")?;
    writeln!(file, "  \"automaton_bytes\": {automaton_size},")?;
    writeln!(file, "  \"files\": [")?;
    writeln!(file, "    \"automaton.bin\",")?;
    writeln!(file, "    \"manifest.json\",")?;
    writeln!(file, "    \"progress.tsv\"")?;
    writeln!(file, "  ]")?;
    writeln!(file, "}}")?;
    Ok(())
}

fn dump_path(dumps: &Path, wiki: &str, date: &str, component: &str) -> PathBuf {
    dumps
        .join(wiki)
        .join(date)
        .join(format!("{wiki}-{date}-{component}.sql.gz"))
}

fn read_pages(path: &Path, limit: Option<usize>) -> Result<HashMap<u64, Page>> {
    let mut pages = HashMap::new();
    for_insert_values(path, "page", limit, |fields| {
        if fields.len() < 4 {
            return Ok(());
        }
        let page_id = parse_u64(&fields[0])?;
        let namespace = parse_i32(&fields[1])?;
        if namespace != 0 {
            return Ok(());
        }
        let title = fields[2].clone();
        pages.insert(page_id, Page { title, qid: None });
        Ok(())
    })?;
    Ok(pages)
}

fn attach_page_qids(
    path: &Path,
    pages: &mut HashMap<u64, Page>,
    limit: Option<usize>,
) -> Result<usize> {
    let mut qid_count = 0;
    for_insert_values(path, "page_props", limit, |fields| {
        if fields.len() < 3 {
            return Ok(());
        }
        if fields[1] != "wikibase_item" {
            return Ok(());
        }
        let page_id = parse_u64(&fields[0])?;
        if let Some(page) = pages.get_mut(&page_id) {
            if page.qid.is_none() {
                qid_count += 1;
            }
            page.qid = Some(fields[2].clone());
        }
        Ok(())
    })?;
    Ok(qid_count)
}

fn read_redirects(
    wiki: &str,
    path: &Path,
    pages: &HashMap<u64, Page>,
    limit: Option<usize>,
) -> Result<Vec<SurfaceRow>> {
    let mut title_to_page_id = HashMap::with_capacity(pages.len());
    for (page_id, page) in pages {
        title_to_page_id.insert(page.title.as_str(), *page_id);
    }

    let mut redirects = Vec::new();
    for_insert_values(path, "redirect", limit, |fields| {
        if fields.len() < 3 {
            return Ok(());
        }
        let source_page_id = parse_u64(&fields[0])?;
        let namespace = parse_i32(&fields[1])?;
        if namespace != 0 {
            return Ok(());
        }
        let target_title = &fields[2];
        let Some(source_page) = pages.get(&source_page_id) else {
            return Ok(());
        };
        let Some(target_page_id) = title_to_page_id.get(target_title.as_str()) else {
            return Ok(());
        };
        let Some(target_page) = pages.get(target_page_id) else {
            return Ok(());
        };
        let Some(qid) = &target_page.qid else {
            return Ok(());
        };

        redirects.push(SurfaceRow {
            wiki: wiki.to_string(),
            surface_key: normalize_surface_key(&source_page.title),
            surface_text: title_to_surface_text(&source_page.title),
            qid: qid.clone(),
            source: "redirect",
            page_id: source_page_id,
            target_page_id: *target_page_id,
        });
        Ok(())
    })?;

    Ok(redirects)
}

fn build_surface_rows(
    wiki: &str,
    pages: &HashMap<u64, Page>,
    redirects: &[SurfaceRow],
) -> Vec<SurfaceRow> {
    let mut rows = Vec::new();

    for (page_id, page) in pages {
        if let Some(qid) = &page.qid {
            let surface_key = normalize_surface_key(&page.title);
            if surface_key.is_empty() {
                continue;
            }
            rows.push(SurfaceRow {
                wiki: wiki.to_string(),
                surface_key,
                surface_text: title_to_surface_text(&page.title),
                qid: qid.clone(),
                source: "page_title",
                page_id: *page_id,
                target_page_id: *page_id,
            });
        }
    }
    rows.extend(redirects.iter().map(|row| SurfaceRow {
        wiki: row.wiki.clone(),
        surface_key: row.surface_key.clone(),
        surface_text: row.surface_text.clone(),
        qid: row.qid.clone(),
        source: row.source,
        page_id: row.page_id,
        target_page_id: row.target_page_id,
    }));

    rows.sort_by(|a, b| {
        a.surface_key
            .cmp(&b.surface_key)
            .then_with(|| a.qid.cmp(&b.qid))
            .then_with(|| a.wiki.cmp(&b.wiki))
            .then_with(|| a.source.cmp(b.source))
    });

    let mut unique_rows = Vec::with_capacity(rows.len());
    let mut unique_seen = HashSet::<String>::new();
    for row in rows {
        let key = format!(
            "{}\t{}\t{}\t{}\t{}",
            row.wiki, row.surface_key, row.qid, row.source, row.page_id
        );
        if !row.surface_key.is_empty() && unique_seen.insert(key) {
            unique_rows.push(row);
        }
    }

    unique_rows
}

fn build_surface_qid_lists(rows: &[SurfaceRow]) -> Vec<(String, Vec<String>)> {
    let mut by_surface = HashMap::<String, HashSet<String>>::new();
    for row in rows {
        by_surface
            .entry(row.surface_key.clone())
            .or_default()
            .insert(row.qid.clone());
    }

    let mut result = by_surface
        .into_iter()
        .map(|(surface_key, qids)| {
            let mut qids = qids.into_iter().collect::<Vec<_>>();
            qids.sort();
            (surface_key, qids)
        })
        .collect::<Vec<_>>();
    result.sort_by(|a, b| a.0.cmp(&b.0));
    result
}

fn count_ambiguous_surfaces(surface_qids: &[(String, Vec<String>)]) -> usize {
    surface_qids
        .iter()
        .filter(|(_surface_key, qids)| qids.len() > 1)
        .count()
}

fn for_insert_values<F>(
    path: &Path,
    table_name: &str,
    limit: Option<usize>,
    mut handle: F,
) -> Result<()>
where
    F: FnMut(Vec<String>) -> Result<()>,
{
    if !path.exists() {
        return Err(CliError(format!("missing dump file: {}", path.display())).into());
    }

    let mut child = Command::new("gzip")
        .arg("-dc")
        .arg(path)
        .stdout(Stdio::piped())
        .spawn()?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| CliError("failed to read gzip stdout".to_string()))?;
    let reader = BufReader::new(stdout);
    let insert_prefix = format!("INSERT INTO `{table_name}` VALUES ");
    let mut handled = 0usize;

    for line in reader.split(b'\n') {
        let line = line?;
        let line = String::from_utf8_lossy(&line);
        if !line.starts_with(&insert_prefix) {
            continue;
        }
        let values = line
            .strip_prefix(&insert_prefix)
            .unwrap_or(&line)
            .trim_end_matches(';');

        parse_insert_tuples(values, |fields| {
            if let Some(limit) = limit {
                if handled >= limit {
                    return Ok(());
                }
            }
            handle(fields)?;
            handled += 1;
            Ok(())
        })?;
    }

    let status = child.wait()?;
    if !status.success() {
        return Err(CliError(format!("gzip failed for {}", path.display())).into());
    }

    Ok(())
}

fn parse_insert_tuples<F>(input: &str, mut handle: F) -> Result<()>
where
    F: FnMut(Vec<String>) -> Result<()>,
{
    let bytes = input.as_bytes();
    let mut index = 0usize;

    while index < bytes.len() {
        while index < bytes.len() && (bytes[index] == b',' || bytes[index].is_ascii_whitespace()) {
            index += 1;
        }
        if index >= bytes.len() {
            break;
        }
        if bytes[index] != b'(' {
            return Err(CliError(format!("expected tuple at byte {index}")).into());
        }
        index += 1;

        let mut fields = Vec::new();
        let mut current = Vec::<u8>::new();
        let mut in_string = false;
        let mut is_null = false;

        while index < bytes.len() {
            let byte = bytes[index];
            if in_string {
                match byte {
                    b'\\' => {
                        index += 1;
                        if index >= bytes.len() {
                            break;
                        }
                        current.push(mysql_unescape_byte(bytes[index]));
                    }
                    b'\'' => in_string = false,
                    _ => current.push(byte),
                }
                index += 1;
                continue;
            }

            match byte {
                b'\'' => {
                    in_string = true;
                    index += 1;
                }
                b',' => {
                    fields.push(if is_null {
                        String::new()
                    } else {
                        field_to_string(&current)
                    });
                    current.clear();
                    is_null = false;
                    index += 1;
                }
                b')' => {
                    fields.push(if is_null {
                        String::new()
                    } else {
                        field_to_string(&current)
                    });
                    handle(fields)?;
                    index += 1;
                    break;
                }
                b'N' if input[index..].starts_with("NULL") => {
                    is_null = true;
                    index += 4;
                }
                _ => {
                    current.push(byte);
                    index += 1;
                }
            }
        }
    }

    Ok(())
}

fn mysql_unescape_byte(byte: u8) -> u8 {
    match byte {
        b'0' => b'\0',
        b'\'' => b'\'',
        b'"' => b'"',
        b'b' => 0x08,
        b'n' => b'\n',
        b'r' => b'\r',
        b't' => b'\t',
        b'Z' => 0x1a,
        b'\\' => b'\\',
        other => other,
    }
}

fn field_to_string(value: &[u8]) -> String {
    let trimmed = trim_ascii(value);
    String::from_utf8_lossy(trimmed).into_owned()
}

fn trim_ascii(value: &[u8]) -> &[u8] {
    let mut start = 0;
    let mut end = value.len();
    while start < end && value[start].is_ascii_whitespace() {
        start += 1;
    }
    while end > start && value[end - 1].is_ascii_whitespace() {
        end -= 1;
    }
    &value[start..end]
}

fn parse_u64(value: &str) -> Result<u64> {
    value
        .parse::<u64>()
        .map_err(|err| CliError(format!("expected u64 `{value}`: {err}")).into())
}

fn parse_i32(value: &str) -> Result<i32> {
    value
        .parse::<i32>()
        .map_err(|err| CliError(format!("expected i32 `{value}`: {err}")).into())
}

fn normalize_surface_key(title: &str) -> String {
    title_to_surface_text(title).trim().to_string()
}

fn title_to_surface_text(title: &str) -> String {
    title.replace('_', " ")
}

fn write_surface_sources_tsv(path: &Path, rows: &[SurfaceRow]) -> Result<()> {
    let mut file = File::create(path)?;
    writeln!(
        file,
        "surface_key\tsurface_text\tqid\twiki\tsource\tpage_id\ttarget_page_id"
    )?;
    for row in rows {
        writeln!(
            file,
            "{}\t{}\t{}\t{}\t{}\t{}\t{}",
            escape_tsv(&row.surface_key),
            escape_tsv(&row.surface_text),
            escape_tsv(&row.qid),
            escape_tsv(&row.wiki),
            row.source,
            row.page_id,
            row.target_page_id
        )?;
    }
    Ok(())
}

fn write_surface_qid_lists_tsv(path: &Path, rows: &[(String, Vec<String>)]) -> Result<()> {
    let mut file = File::create(path)?;
    writeln!(file, "surface_key\tqids\tqid_count")?;
    for (surface_key, qids) in rows {
        writeln!(
            file,
            "{}\t{}\t{}",
            escape_tsv(surface_key),
            escape_tsv(&qids.join("|")),
            qids.len()
        )?;
    }
    Ok(())
}

fn write_preprocess_manifest(path: &Path, args: &ProcessArgs, summaries: &[String]) -> Result<()> {
    let mut file = File::create(path)?;
    writeln!(file, "{{")?;
    writeln!(file, "  \"generated_at_unix\": {},", generated_at_unix())?;
    writeln!(file, "  \"date\": \"{}\",", escape_json(&args.date))?;
    writeln!(
        file,
        "  \"dumps\": \"{}\",",
        escape_json(&path_for_manifest(&args.dumps))
    )?;
    writeln!(
        file,
        "  \"out\": \"{}\",",
        escape_json(&path_for_manifest(&args.out))
    )?;
    writeln!(file, "  \"wikis\": [")?;
    for (index, wiki) in args.wikis.iter().enumerate() {
        let comma = if index + 1 == args.wikis.len() {
            ""
        } else {
            ","
        };
        writeln!(file, "    \"{}\"{comma}", escape_json(wiki))?;
    }
    writeln!(file, "  ],")?;
    writeln!(file, "  \"files\": [")?;
    writeln!(file, "    \"surface_qids.tsv\",")?;
    writeln!(file, "    \"surface_sources.tsv\"")?;
    writeln!(file, "  ],")?;
    writeln!(file, "  \"summaries\": [")?;
    for (index, summary) in summaries.iter().enumerate() {
        let comma = if index + 1 == summaries.len() {
            ""
        } else {
            ","
        };
        writeln!(file, "    \"{}\"{comma}", escape_json(summary))?;
    }
    writeln!(file, "  ]")?;
    writeln!(file, "}}")?;
    Ok(())
}

fn escape_tsv(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('\t', "\\t")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
}

fn build_targets(args: &DownloadArgs) -> Result<Vec<DownloadTarget>> {
    let mut targets = Vec::new();

    for component in &args.components {
        match component {
            Component::Page | Component::Redirect | Component::PageProps => {
                for wiki in &args.wikis {
                    if wiki.trim().is_empty() {
                        return Err(CliError("wiki names must not be empty".to_string()).into());
                    }
                    targets.push(wikipedia_sql_target(
                        &args.out,
                        wiki,
                        args.date.as_str(),
                        *component,
                    )?);
                }
            }
            Component::WikidataEntities => {
                targets.push(wikidata_entities_target(&args.out, args.date.as_str()));
            }
        }
    }

    Ok(targets)
}

fn wikipedia_sql_target(
    out: &Path,
    wiki: &str,
    date: &str,
    component: Component,
) -> Result<DownloadTarget> {
    let dump_name = match component {
        Component::Page => "page",
        Component::Redirect => "redirect",
        Component::PageProps => "page_props",
        Component::WikidataEntities => {
            return Err(
                CliError("wikidata_entities is not a Wikipedia SQL component".to_string()).into(),
            )
        }
    };
    let file_name = format!("{wiki}-{date}-{dump_name}.sql.gz");
    let url = format!("{WIKIMEDIA_DUMPS_BASE}/{wiki}/{date}/{file_name}");
    let path = out.join(wiki).join(date).join(file_name);

    Ok(DownloadTarget {
        component,
        wiki: Some(wiki.to_string()),
        url,
        path,
    })
}

fn wikidata_entities_target(out: &Path, date: &str) -> DownloadTarget {
    let (url, file_name) = if date == "latest" {
        (
            format!("{WIKIMEDIA_DUMPS_BASE}/wikidatawiki/entities/latest-all.json.bz2"),
            "latest-all.json.bz2".to_string(),
        )
    } else {
        (
            format!(
                "{WIKIMEDIA_DUMPS_BASE}/wikidatawiki/entities/{date}/wikidata-{date}-all.json.bz2"
            ),
            format!("wikidata-{date}-all.json.bz2"),
        )
    };
    let path = out.join("wikidatawiki").join(date).join(file_name);

    DownloadTarget {
        component: Component::WikidataEntities,
        wiki: None,
        url,
        path,
    }
}

fn download_target(target: &DownloadTarget, user_agent: &str, force: bool) -> Result<()> {
    if let Some(parent) = target.path.parent() {
        fs::create_dir_all(parent)?;
    }

    if target.path.exists() && !force {
        eprintln!("exists {}, skipping", target.path.display());
        return Ok(());
    }

    if force && target.path.exists() {
        fs::remove_file(&target.path)?;
    }

    let partial_path = partial_path(&target.path);
    let mut curl = Command::new("curl");
    curl.arg("--fail")
        .arg("--location")
        .arg("--retry")
        .arg("3")
        .arg("--retry-delay")
        .arg("2")
        .arg("--user-agent")
        .arg(user_agent)
        .arg("--output")
        .arg(&partial_path);

    if partial_path.exists() {
        curl.arg("--continue-at").arg("-");
    }

    curl.arg(&target.url);

    eprintln!("downloading {}", target.url);
    let status = curl.status()?;
    if !status.success() {
        return Err(CliError(format!("curl failed for {}", target.url)).into());
    }

    fs::rename(&partial_path, &target.path)?;
    let bytes = target.path.metadata()?.len();
    eprintln!("wrote {} ({bytes} bytes)", target.path.display());

    Ok(())
}

fn require_curl() -> Result<()> {
    let status = Command::new("curl")
        .arg("--version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
    match status {
        Ok(status) if status.success() => Ok(()),
        _ => Err(CliError("curl is required for downloads".to_string()).into()),
    }
}

fn require_gzip() -> Result<()> {
    let status = Command::new("gzip")
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    match status {
        Ok(status) if status.success() => Ok(()),
        _ => Err(CliError("gzip is required for processing dumps".to_string()).into()),
    }
}

fn partial_path(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("download");
    path.with_file_name(format!("{file_name}.part"))
}

fn write_manifest(path: &Path, date: &str, targets: &[DownloadTarget]) -> Result<()> {
    let mut file = File::create(path)?;
    writeln!(file, "{{")?;
    writeln!(file, "  \"generated_at_unix\": {},", generated_at_unix())?;
    writeln!(file, "  \"date\": \"{}\",", escape_json(date))?;
    writeln!(file, "  \"files\": [")?;

    for (index, target) in targets.iter().enumerate() {
        let comma = if index + 1 == targets.len() { "" } else { "," };
        let bytes = target.path.metadata().map(|metadata| metadata.len()).ok();
        writeln!(file, "    {{")?;
        writeln!(
            file,
            "      \"component\": \"{}\",",
            target.component.as_str()
        )?;
        match &target.wiki {
            Some(wiki) => writeln!(file, "      \"wiki\": \"{}\",", escape_json(wiki))?,
            None => writeln!(file, "      \"wiki\": null,")?,
        }
        writeln!(file, "      \"url\": \"{}\",", escape_json(&target.url))?;
        writeln!(
            file,
            "      \"path\": \"{}\",",
            escape_json(&path_for_manifest(&target.path))
        )?;
        match bytes {
            Some(bytes) => writeln!(file, "      \"bytes\": {bytes}")?,
            None => writeln!(file, "      \"bytes\": null")?,
        }
        writeln!(file, "    }}{comma}")?;
    }

    writeln!(file, "  ]")?;
    writeln!(file, "}}")?;
    Ok(())
}

fn path_for_manifest(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn validate_date(date: &str) -> Result<()> {
    if date == "latest" {
        return Ok(());
    }
    let valid = date.len() == 8 && date.bytes().all(|byte| byte.is_ascii_digit());
    if !valid {
        return Err(CliError(format!("date must be latest or YYYYMMDD, got {date}")).into());
    }
    Ok(())
}

fn generated_at_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn escape_json(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '"' => escaped.push_str("\\\""),
            '\\' => escaped.push_str("\\\\"),
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            '\t' => escaped.push_str("\\t"),
            ch if ch.is_control() => escaped.push_str(&format!("\\u{:04x}", ch as u32)),
            ch => escaped.push(ch),
        }
    }
    escaped
}

fn print_help() {
    println!("wikipage-spine-dataset-builder");
    println!();
    println!("Commands:");
    println!("  download    Download upstream Wikimedia dump files");
    println!("  preprocess  Extract surface_key -> QID[] rows from downloaded dumps");
    println!("  compile     Compile surface keys into an Aho-Corasick automaton");
    println!();
    println!("Run `wikipage-spine-dataset-builder download --help` for download options.");
}

fn print_download_help() {
    println!("Usage:");
    println!("  wikipage-spine-dataset-builder download [options]");
    println!();
    println!("Options:");
    println!("  --out <dir>                  Output directory (default: crates/data/dumps)");
    println!("  --wikis <csv>                Wiki DB names (default: zhwiki,enwiki)");
    println!("  --components <csv>           page,redirect,page_props,wikidata_entities");
    println!("                               default: page,redirect,page_props");
    println!("  --date <latest|YYYYMMDD>     Dump date (default: latest)");
    println!("  --user-agent <value>         User-Agent for Wikimedia downloads");
    println!("  --dry-run                    Print URLs without downloading");
    println!("  --force                      Redownload existing final files");
}

fn print_process_help() {
    println!("Usage:");
    println!("  wikipage-spine-dataset-builder preprocess [options]");
    println!();
    println!("Options:");
    println!(
        "  --dumps <dir>                Downloaded dump directory (default: crates/data/dumps)"
    );
    println!("  --out <dir>                  Output directory (default: crates/data/preprocess)");
    println!("  --wikis <csv>                Wiki DB names (default: zhwiki,enwiki)");
    println!("  --date <latest|YYYYMMDD>     Dump date (default: latest)");
    println!("  --limit <n>                  Debug limit for parsed INSERT tuples per table");
}

fn print_compile_help() {
    println!("Usage:");
    println!("  wikipage-spine-dataset-builder compile [options]");
    println!();
    println!("Options:");
    println!(
        "  --preprocess <dir>           Preprocess directory (default: crates/data/preprocess)"
    );
    println!("  --out <dir>                  Output directory (default: crates/data/compile)");
    println!("  --mode <charwise|bytewise>   Daachorse automaton mode (default: charwise)");
    println!("  --limit <n>                  Debug limit for surface rows");
    println!("  --progress-every <n>         Progress interval (default: 100000)");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compact_ac::{CharwiseDoubleArrayAhoCorasick, DoubleArrayAhoCorasick};

    #[test]
    fn charwise_automaton_preserves_surface_ids_after_serialize() {
        let bytes = build_automaton_bytes(
            vec![
                "北京".to_string(),
                "北京大学".to_string(),
                "大学".to_string(),
            ],
            CompileMode::Charwise,
        )
        .unwrap();
        let (automaton, rest) = CharwiseDoubleArrayAhoCorasick::<u32>::deserialize(&bytes).unwrap();
        assert!(rest.is_empty());

        let hits = automaton
            .find_overlapping_iter("我在北京大学")
            .map(|m| (m.start(), m.end(), m.value()))
            .collect::<Vec<_>>();

        assert_eq!(hits, vec![(6, 12, 0), (6, 18, 1), (12, 18, 2)]);
    }

    #[test]
    fn bytewise_automaton_preserves_surface_ids_after_serialize() {
        let bytes = build_automaton_bytes(
            vec!["bcd".to_string(), "ab".to_string(), "a".to_string()],
            CompileMode::Bytewise,
        )
        .unwrap();
        let (automaton, rest) = DoubleArrayAhoCorasick::<u32>::deserialize(&bytes).unwrap();
        assert!(rest.is_empty());

        let hits = automaton
            .find_overlapping_iter("abcd")
            .map(|m| (m.start(), m.end(), m.value()))
            .collect::<Vec<_>>();

        assert_eq!(hits, vec![(0, 1, 2), (0, 2, 1), (1, 4, 0)]);
    }
}

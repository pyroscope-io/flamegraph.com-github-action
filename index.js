const core = require("@actions/core");
const httpm = require("@actions/http-client");
const fs = require("fs").promises;
const { SUMMARY_ENV_VAR } = require("@actions/core/lib/summary");
const { promisify } = require("util");
const g = require("glob");
const glob = promisify(g);

const http = new httpm.HttpClient("");

async function findFiles() {
  return glob(core.getInput("file"));
}

async function upload(filepath) {
  const file = await fs.readFile(filepath, { encoding: "base64" });

  const baseUrl = "https://www.flamegraph.com";

  const data = {
    filename: filepath,
    name: filepath,
    profile: file,
  };

  const res = await http.postJson(`${baseUrl}/api/upload/v1`, {
    ...data,
  });

  return { url: res.result.url, key: res.result.key };
}

function NewSummary() {
  // TODO: summary is disabled in act?
  // create a proxy to debug if commands were called correctly
  if (!process.env[SUMMARY_ENV_VAR]) {
    const handler = {
      get(target, prop, receiver) {
        if (typeof target[prop] === "function") {
          // Noop
          return (...args) => {
            console.log(`${prop}`, { args });
            return receiver;
          };
        }
        return null;
      },
    };
    return new Proxy(core.summary, handler);
  }

  return core.summary;
}

async function buildSummary(files) {
  const Summary = NewSummary();

  //  if (files.length === 1) {
  //    const file = files[0];
  //    core.setOutput("url", file.url);
  //
  //    await Summary.addHeading("Results", 2)
  //      .addLink("View Run in Flamegraph.com", file.url)
  //      .addImage(`https://flamegraph.com/api/preview/${file.key}`, file.filepath)
  //      .write();
  //
  //    return;
  //  }
  //
  //  const summaries = files.map((f) => {
  //    return Summary.addHeading(f.filepath, 4)
  //      .addLink("View Run in Flamegraph.com", f.url)
  //      .addImage(`https://flamegraph.com/api/preview/${f.key}`, f.filepath)
  //      .stringify();
  //  });

  for (const f of files) {
    Summary.addHeading(f.filepath, 4)
      .addLink("View Run in Flamegraph.com", f.url)
      .addRaw(
        `<a href="${f.filepath}"><img src="https://flamegraph.com/api/preview/${f.key}" /></a>`
      );
    //      .addImage(`https://flamegraph.com/api/preview/${f.key}`, f.filepath, {})
  }
  await Summary.write();
}

async function run() {
  const files = (await findFiles()).map((a) => ({
    filepath: a,
  }));

  for (const file of files) {
    try {
      const res = await upload(file.filepath);
      file.url = res.url;
      file.key = res.key;
    } catch (error) {
      core.setFailed(error.message);
      return;
    }
  }

  await buildSummary(files);
}

run();

const ORIGENES = {
  "/api/produccion": {
    secret: "DROPBOX_PRODUCCION_URL",
    archivo: "produccion.xlsx",
    tipo: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  },
  "/api/recibo": {
    secret: "DROPBOX_RECIBO_URL",
    archivo: "recibo.xlsb",
    tipo: "application/vnd.ms-excel.sheet.binary.macroEnabled.12"
  }
};

function error(mensaje, status = 500) {
  return Response.json(
    { error: mensaje },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      }
    }
  );
}

async function descargarExcel(config, env) {
  const secreto = env[config.secret];

  if (!secreto) {
    return error(
      "Falta configurar el Secret " + config.secret + ".",
      503
    );
  }

  let enlace;

  try {
    enlace = new URL(secreto.trim());

    const dominioValido = [
      "dl.dropbox.com",
      "www.dropbox.com",
      "dropbox.com"
    ].includes(enlace.hostname);

    if (
      enlace.protocol !== "https:" ||
      !dominioValido ||
      enlace.username ||
      enlace.password
    ) {
      return error(
        "El Secret " + config.secret +
        " debe contener un enlace HTTPS de Dropbox.",
        503
      );
    }

    enlace.searchParams.set("dl", "1");
  } catch {
    return error(
      "El Secret " + config.secret +
      " no contiene un enlace válido.",
      503
    );
  }

  try {
    const respuesta = await fetch(enlace.toString(), {
      method: "GET",
      redirect: "follow",
      headers: {
        "Accept": "application/octet-stream",
        "Cache-Control": "no-cache"
      },
      cf: {
        cacheTtl: 0,
        cacheEverything: false
      },
      signal: AbortSignal.timeout(80000)
    });

    if (!respuesta.ok) {
      await respuesta.body?.cancel();

      return error(
        "Dropbox no pudo entregar el archivo (HTTP " +
        respuesta.status + ").",
        502
      );
    }

    const tipo = (
      respuesta.headers.get("Content-Type") || ""
    ).toLowerCase();

    if (
      tipo.includes("text/html") ||
      tipo.includes("application/json") ||
      !respuesta.body
    ) {
      await respuesta.body?.cancel();

      return error(
        "Dropbox devolvió una página en lugar del Excel. " +
        "Revisá el enlace del Secret.",
        502
      );
    }

    return new Response(respuesta.body, {
      headers: {
        "Content-Type": config.tipo,
        "Content-Disposition":
          'inline; filename="' + config.archivo + '"',
        "Cache-Control": "no-store, max-age=0",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (e) {
    const timeout =
      e.name === "TimeoutError" ||
      e.name === "AbortError";

    return error(
      timeout
        ? "Dropbox demoró demasiado. Intentá actualizar nuevamente."
        : "No se pudo descargar el Excel desde Dropbox. Intentá actualizar nuevamente.",
      502
    );
  }
}

export default {
  async fetch(request, env) {
    const ruta = new URL(request.url).pathname;

    if (ruta.startsWith("/api/")) {
      if (request.method !== "GET") {
        return error("Método no permitido.", 405);
      }

      const config = ORIGENES[ruta];

      return config
        ? descargarExcel(config, env)
        : error("Ruta no encontrada.", 404);
    }

    const respuesta = await env.ASSETS.fetch(request);
    const salida = new Response(respuesta.body, respuesta);

    const tipo = salida.headers.get("Content-Type") || "";

    if (tipo.includes("text/html")) {
      salida.headers.set(
        "Cache-Control",
        "no-store, max-age=0"
      );
    }

    salida.headers.set(
      "X-Content-Type-Options",
      "nosniff"
    );

    return salida;
  }
};

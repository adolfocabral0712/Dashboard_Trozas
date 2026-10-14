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
  },

  "/api/despachos": {
    secret: "DROPBOX_DESPACHOS_URL",
    archivo: "despachos.json",
    tipo: "application/json; charset=utf-8",
    json: true
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

async function descargarFuente(config, env) {
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
        "Accept": config.json
          ? "application/json"
          : "application/octet-stream",

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
      (!config.json && tipo.includes("application/json")) ||
      !respuesta.body
    ) {
      await respuesta.body?.cancel();

      return error(
        "Dropbox no devolvió el archivo esperado. " +
        "Revisá el enlace del Secret.",
        502
      );
    }

    // JSON de despachos: entregar solamente LAS ACACIAS UPM.
    if (config.json) {
      const datos = await respuesta.json();

      const registros = Array.isArray(datos)
        ? datos
        : datos.registros;

      if (!Array.isArray(registros)) {
        return error(
          "El JSON de Despachos no contiene una lista registros.",
          502
        );
      }

      const filtrados = registros.filter(registro => {
        if (
          !registro ||
          typeof registro !== "object"
        ) {
          return false;
        }

        const predio = String(registro.predio || "")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toUpperCase();

        return predio.includes("LAS ACACIAS UPM");
      });

      return Response.json(
        {
          actualizado: datos.actualizado || null,
          cantidadRegistros: filtrados.length,
          registros: filtrados
        },
        {
          headers: {
            "Cache-Control": "no-store, max-age=0",
            "X-Content-Type-Options": "nosniff"
          }
        }
      );
    }

    // Archivos Excel: transmitir sin exponer el enlace de Dropbox.
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
        : "No se pudo descargar el archivo desde Dropbox. Intentá actualizar nuevamente.",
      502
    );
  }
}

export default {
  async fetch(request, env) {
    const ruta = new URL(request.url).pathname;

    // Rutas de datos.
    if (ruta.startsWith("/api/")) {
      if (request.method !== "GET") {
        return error(
          "Método no permitido.",
          405
        );
      }

      const config = ORIGENES[ruta];

      if (!config) {
        return error(
          "Ruta no encontrada.",
          404
        );
      }

      return descargarFuente(config, env);
    }

    // Dashboard y archivos estáticos.
    const respuesta = await env.ASSETS.fetch(request);

    const salida = new Response(
      respuesta.body,
      respuesta
    );

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

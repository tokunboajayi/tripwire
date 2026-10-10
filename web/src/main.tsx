import React from "react";
import { createRoot } from "react-dom/client";
import { Auth0Provider } from "@auth0/auth0-react";
import "./platform";
import App from "./App";
import "./styles.css";
const domain = import.meta.env.VITE_AUTH0_DOMAIN, clientId = import.meta.env.VITE_AUTH0_CLIENT_ID, audience = import.meta.env.VITE_AUTH0_AUDIENCE;
const root = createRoot(document.getElementById("root")!);
root.render(domain
  ? <Auth0Provider domain={domain} clientId={clientId} authorizationParams={{ redirect_uri: window.location.origin, audience }}><App auth0 /></Auth0Provider>
  : <App auth0={false} />);

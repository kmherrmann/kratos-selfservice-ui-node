import { SelfServiceLoginFlow, UiNodeInputAttributes } from "@ory/client"
import { UserAuthCard, SelfServiceFlow } from "@ory/elements-markup"
import {
  filterNodesByGroups,
  isUiNodeInputAttributes,
} from "@ory/integrations/ui"
import {
  defaultConfig,
  getUrlForFlow,
  isQuerySet,
  logger,
  redirectOnSoftError,
  RouteCreator,
  RouteRegistrator,
} from "../pkg"

export const createLoginRoute: RouteCreator =
  (createHelpers) => async (req, res, next) => {
    res.locals.projectName = "Sign in"

    const {
      flow,
      aal = "",
      refresh = "",
      return_to = "",
      login_challenge,
    } = req.query
    const helpers = createHelpers(req)
    const { sdk, kratosBrowserUrl } = helpers

    const initFlowQuery = new URLSearchParams({
      aal: aal.toString(),
      refresh: refresh.toString(),
      return_to: return_to.toString(),
    })

    if (isQuerySet(login_challenge)) {
      logger.debug("login_challenge found in URL query: ", { query: req.query })
      initFlowQuery.append("login_challenge", login_challenge)
    }

    const initFlowUrl = getUrlForFlow(kratosBrowserUrl, "login", initFlowQuery)

    // The flow is used to identify the settings and registration flow and
    // return data like the csrf_token and so on.
    if (!isQuerySet(flow)) {
      logger.debug("No flow ID found in URL query initializing login flow", {
        query: req.query,
      })
      res.redirect(303, initFlowUrl)
      return
    }

    // It is probably a bit strange to have a logout URL here, however this screen
    // is also used for 2FA flows. If something goes wrong there, we probably want
    // to give the user the option to sign out!
    const logoutUrl =
      (
        await sdk
          .createSelfServiceLogoutFlowUrlForBrowsers(req.header("cookie"))
          .catch(() => ({ data: { logout_url: "" } }))
      ).data.logout_url || ""

    return sdk
      .getSelfServiceLoginFlow(flow, req.header("cookie"))
      .then(({ data: flow }: { data: SelfServiceLoginFlow & any }) => {
        // Render the data using a view (e.g. Jade Template):

        const initRegistrationQuery = new URLSearchParams({
          return_to: return_to.toString(),
        })
        if (flow.oauth2_login_request?.challenge) {
          initRegistrationQuery.set(
            "login_challenge",
            flow.oauth2_login_request.challenge,
          )
        }

        const initRegistrationUrl = getUrlForFlow(
          kratosBrowserUrl,
          "registration",
          initRegistrationQuery,
        )

        res.render("login", {
          nodes: flow.ui.nodes,
          webAuthnHandler: filterNodesByGroups({
            nodes: flow.ui.nodes,
            groups: ["webauthn"],
            attributes: ["button"],
            withoutDefaultAttributes: true,
            withoutDefaultGroup: true,
          })
            .filter(({ attributes }) => isUiNodeInputAttributes(attributes))
            .map(({ attributes }) => {
              return (attributes as UiNodeInputAttributes).onclick
            })
            .filter((c) => c !== undefined),
          card: UserAuthCard({
            title: !(flow.refresh || flow.requested_aal === "aal2")
              ? "Sign In"
              : "Two-Factor Authentication",
            ...(flow.hydra_login_request && {
              subtitle: `To authenticate ${
                flow.hydra_login_request.client_client_name ||
                flow.hydra_login_request.client_client_id
              }`,
            }),
            flow: flow as SelfServiceFlow,
            flowType: "login",
            cardImage: "ory-logo.svg",
            additionalProps: {
              forgotPasswordURL: "recovery",
              signupURL: initRegistrationUrl,
              logoutURL: logoutUrl,
            },
          }),
        })
      })
      .catch(redirectOnSoftError(res, next, initFlowUrl))
  }

export const registerLoginRoute: RouteRegistrator = (
  app,
  createHelpers = defaultConfig,
) => {
  app.get("/login", createLoginRoute(createHelpers))
}

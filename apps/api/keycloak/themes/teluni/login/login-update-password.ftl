<#--
  Derived from login-update-password.ftl of Keycloak 26.8.1's keycloak.v2
  theme (Apache License 2.0). Changed for Teluni: choosing a new password
  always ends the person's other sessions, as password recovery must (P15 in
  docs/project/identity-and-access.md), instead of offering a checkbox that
  starts unchecked.
-->
<#import "template.ftl" as layout>
<#import "field.ftl" as field>
<#import "buttons.ftl" as buttons>
<#import "password-validation.ftl" as validator>
<@layout.registrationLayout displayMessage=!messagesPerField.existsError('password','password-confirm'); section>
<!-- template: login-update-password.ftl -->
    <#if section = "header">
        ${msg("updatePasswordTitle")}
    <#elseif section = "form">
        <form id="kc-passwd-update-form" class="${properties.kcFormClass!}" onsubmit="login.disabled = true; return true;" action="${url.loginAction}" method="post" novalidate="novalidate">
            <@field.password name="password-new" label=msg("passwordNew") fieldName="password" autocomplete="new-password" autofocus=true />
            <@field.password name="password-confirm" label=msg("passwordConfirm") autocomplete="new-password" />

            <input type="hidden" name="logout-sessions" value="on"/>
            <p id="teluni-logout-notice" class="${properties.kcFormGroupClass!}">${msg("teluniLogoutOtherSessions")}</p>

            <@buttons.actionGroup horizontal=true>
                <#if isAppInitiatedAction??>
                    <@buttons.button id="kc-submit" name="login" label="doSubmit"/>
                    <@buttons.button id="kc-cancel" label="doCancel" name="cancel-aia" type="secondary"/>
                <#else>
                    <@buttons.button id="kc-submit" name="login" label="doSubmit"/>
                </#if>
            </@buttons.actionGroup>
        </form>

        <@validator.templates/>
        <@validator.script field="password-new"/>
    </#if>
</@layout.registrationLayout>

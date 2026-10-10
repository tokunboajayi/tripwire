import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        # 1. Sign in as aj
        await page.goto("http://localhost:8080/")
        # check if there is an input and a button
        await page.fill("input", "aj")
        await page.click("button:has-text('Sign In')")
        
        await asyncio.sleep(1)
        
        # 2. Fund account (we might be on onboarding or overview already if funded, let's see)
        if "Overview" not in await page.content():
            try:
                await page.click("button:has-text('Fund')")
            except Exception: pass
            
        await asyncio.sleep(1)
        
        # 3. Check platforms
        print("Checking platforms...")
        for plat in ["windows", "mac", "ios"]:
            await page.goto(f"http://localhost:8080/?platform={plat}")
            await asyncio.sleep(1)
            content = await page.content()
            # check for sidebar vs bottom tab bar
            has_sidebar = 'w-64' in content or 'sidebar' in content.lower()
            has_bottom_bar = 'bottom-0' in content or 'tab bar' in content.lower()
            print(f"platform={plat}: sidebar={has_sidebar}, bottom_bar={has_bottom_bar}")
            
        # 4. Proof page
        await page.goto("http://localhost:8080/?platform=windows")
        await asyncio.sleep(1)
        await page.click("text=Proof")
        await asyncio.sleep(1)
        await page.click("button:has-text('Verify it yourself')")
        
        await asyncio.sleep(3)
        # get all the steps text
        content = await page.content()
        print("--- PROOF TEXT ---")
        # Just extract all text that looks like a step
        # Playwright provides a way to get text of locators
        loc = page.locator("text=/Step\\s*\\d+/i")
        count = await loc.count()
        if count == 0:
            print("Could not find step text. Dumping full text of page.")
            print(await page.evaluate("document.body.innerText"))
        else:
            print(await page.evaluate("document.body.innerText"))

        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())

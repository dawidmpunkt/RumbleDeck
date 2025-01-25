import {
  ButtonItem,
  PanelSection,
  PanelSectionRow,
  //Navigation,
  staticClasses
} from "@decky/ui";
import {
  addEventListener,
  removeEventListener,
  callable,
  definePlugin,
  toaster,
  // routerHook
} from "@decky/api"
import { useState } from "react";
import { MdOutlineVibration } from "react-icons/md";

const backend_function = callable<[parameter_a: number, parameter_b: number], number>("my_backend_function");
//import logo from "../assets/logo.png";

// This function calls the python function "add", which takes in two numbers and returns their sum (as a number)
// Note the type annotations:
//  the first one: [first: number, second: number] is for the arguments
//  the second one: number is for the return value
//const add = callable<[first: number, second: number], number>("add");

// This function calls the python function "start_timer", which takes in no arguments and returns nothing.
// It starts a (python) timer which eventually emits the event 'timer_event'
//const startTimer = callable<[], void>("start_timer");

function Content() {
  const [result, setResult] = useState<number | undefined>();
  const onClick = async () => {
    const result = await backend_function(5, 5);
    setResult(result);
  };
  
  /*const [result, setResult] = useState<number | undefined>();

  const onClick = async () => {
    const result = await add(Math.random(), Math.random());
    setResult(result);
  };*/
  const [isRunning, setIsRunning] = useState(false);

  const startSniffer = async () => {
    await window.DCBackend.callBackend("start_sniffer", {});
    setIsRunning(true);
  };

  const stopSniffer = async () => {
    await window.DCBackend.callBackend("stop_sniffer", {});
    setIsRunning(false);
  };
  
  return (
    <PanelSection title="Main Menu">
        <PanelSectionRow>
        <ButtonItem
          layout="below"
          //test button with standard function
          onClick={onClick}
            //onClick={startSniffer}
          disabled={isRunning}
          //onClick={() => startTimer()}
        >
          {result ?? "Text be here"}          
        
        </ButtonItem>
      </PanelSectionRow>
    </PanelSection>
  );
};

export default definePlugin(() => {
  console.log("Template plugin initializing, this is called once on frontend startup")

  // serverApi.routerHook.addRoute("/decky-plugin-test", DeckyPluginRouterTest, {
  //   exact: true,
  // });

  // Add an event listener to the "timer_event" event from the backend
  const listener = addEventListener<[
    test1: string,
    test2: number,
    test3: number
  ]>("my_backend_function", (test1, test2, test3) => {
    console.log("event:", test1, test2, test3)
    toaster.toast({
      title: "Driver initialized",
      body: `${test1}, ${test2}, ${test3}`
    });
  });

  return {
    // The name shown in various decky menus
    name: "RumbleDeck",
    // The element displayed at the top of your plugin's menu
    titleView: <div className={staticClasses.Title}>RumbleDeck</div>,
    // The content of your plugin's menu
    content: <Content />,
    // The icon displayed in the plugin list
    icon: <MdOutlineVibration />,
    // The function triggered when your plugin unloads
    onDismount() {
      console.log("Unloading")
      removeEventListener("my_backend_function", listener);
      // serverApi.routerHook.removeRoute("/decky-plugin-test");
    },
  };
});
